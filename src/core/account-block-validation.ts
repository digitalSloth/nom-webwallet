import { bech32 } from 'bech32'

/**
 * Pure predicates over raw JSON, mirroring the SDK's own address/token-standard/
 * account-block validation exactly (not a weaker approximation), so the service
 * worker's verdict and the page's `Address.parse`/`AccountBlockTemplate`
 * construction can never disagree. Runnable anywhere — no SDK import, only
 * `bech32`, which the SDK itself uses for the same decode.
 */

// Network protocol constants — cannot change without a chain fork.
// dist/model/primitives/address.js:58-60
const ADDRESS_PREFIX = 'z'
const ADDRESS_CORE_SIZE = 20
// dist/model/primitives/tokenStandard.js:49-50
const TOKEN_STANDARD_PREFIX = 'zts'
const TOKEN_STANDARD_CORE_SIZE = 10

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/
const HEX_64_PATTERN = /^[0-9a-fA-F]{64}$/
// A leading '0x'/'0X' is not part of the base64 alphabet's meaning here — it is
// the one unambiguous signal that a dApp sent hex instead of base64, so it is
// refused. Bare hex with no prefix (e.g. 'deadbeef') is genuinely indistinguishable
// from valid base64 and is accepted by design; rejecting it would also reject
// real base64 payloads that happen to use only [0-9a-fA-F] characters (e.g. 'AAAA').

export function addressProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'Address must be a string.'
  try {
    const decoded = bech32.decode(value) // throws on a bad checksum
    if (decoded.prefix !== ADDRESS_PREFIX) return `Invalid address prefix '${decoded.prefix}'.`
    // NOT decoded.words.length — decode() yields 32 5-bit words for a 20-byte core.
    // fromWords() also throws on invalid padding, so it must sit inside this try.
    if (bech32.fromWords(decoded.words).length !== ADDRESS_CORE_SIZE) {
      return 'Invalid address length.'
    }
  } catch {
    return 'Invalid bech32 encoding for address.'
  }
  return null
}

export function tokenStandardProblem(value: unknown): string | null {
  if (typeof value !== 'string') return 'Token standard must be a string.'
  try {
    const decoded = bech32.decode(value)
    if (decoded.prefix !== TOKEN_STANDARD_PREFIX) {
      return `Invalid token standard prefix '${decoded.prefix}'.`
    }
    // NOT decoded.words.length — see addressProblem.
    if (bech32.fromWords(decoded.words).length !== TOKEN_STANDARD_CORE_SIZE) {
      return 'Invalid token standard length.'
    }
  } catch {
    return 'Invalid bech32 encoding for token standard.'
  }
  return null
}

function amountProblem(amount: unknown): string | null {
  if (typeof amount !== 'string' && typeof amount !== 'number') {
    return "Amount must be a non-negative integer in the token's smallest unit."
  }
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) {
    return 'Amount is too large to be sent as a JSON number; pass it as a string.'
  }
  const asString = String(amount)
  if (!/^\d+$/.test(asString)) {
    return "Amount must be a non-negative integer in the token's smallest unit."
  }
  try {
    BigInt(asString)
  } catch {
    return "Amount must be a non-negative integer in the token's smallest unit."
  }
  return null
}

function dataProblem(data: unknown): string | null {
  if (data === undefined || data === null || data === '') return null
  if (
    typeof data !== 'string' ||
    /^0x/i.test(data) ||
    !BASE64_PATTERN.test(data) ||
    data.length % 4 !== 0
  ) {
    return 'Block data must be base64.'
  }
  return null
}

/** null when the JSON is a usable account block, else the user-facing reason. */
export function accountBlockProblem(json: unknown): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return 'Account block must be an object.'
  }

  const block = json as Record<string, unknown>

  if (block.blockType !== 2 && block.blockType !== 3) {
    return 'Unsupported block type. Only send (2) and receive (3) blocks can be requested.'
  }

  if (block.blockType === 2) {
    const addrProblem = addressProblem(block.toAddress)
    if (addrProblem) return addrProblem

    const ztsProblem = tokenStandardProblem(block.tokenStandard)
    if (ztsProblem) return ztsProblem

    const amtProblem = amountProblem(block.amount)
    if (amtProblem) return amtProblem

    return dataProblem(block.data)
  }

  // blockType === 3 (receive). toAddress, tokenStandard and amount are
  // ignored, not rejected — desktop emits them on receives, and requiring
  // them would refuse AccountBlockTemplate.receive's own minimal shape.
  if (typeof block.fromBlockHash !== 'string' || !HEX_64_PATTERN.test(block.fromBlockHash)) {
    return 'A receive block needs a 64-character hex fromBlockHash.'
  }

  if (block.data !== undefined && block.data !== null && block.data !== '') {
    return 'Receive blocks cannot carry data.'
  }

  return null
}

/** null when {to, tokenStandard, amount} is usable, else the reason. */
export function sendTransactionParamsProblem(params: unknown): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return 'Params must be an object.'
  }

  const p = params as Record<string, unknown>

  const addrProblem = addressProblem(p.to)
  if (addrProblem) return addrProblem

  const ztsProblem = tokenStandardProblem(p.tokenStandard)
  if (ztsProblem) return ztsProblem

  return amountProblem(p.amount)
}

/**
 * Sealed inscriptions: `crypto_box_seal_open` (anonymous X25519,
 * XSalsa20-Poly1305 box) built from noble primitives, plus the plaintext
 * rules of an encrypted ZRC-321 inscription. Format reference:
 * docs/ENCRYPTED_MESSAGES.md, "Sealed inscriptions".
 *
 * Pure and SDK-free, so the service worker can import it. The wallet only
 * opens sealed boxes. Sealing happens in the dApp.
 */
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa'
import { u32, u8 } from '@noble/ciphers/utils'
import { ed25519, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { invert, mod } from '@noble/curves/abstract/modular'
import { blake2b } from '@noble/hashes/blake2b'
import { sha512 } from '@noble/hashes/sha2'

/** Ephemeral public key 32 + tag 16. */
export const SEAL_OVERHEAD = 48
export const SEAL_PAD_BLOCK = 32
export const MAX_SEALED_OPEN_BATCH = 50

const KEY_BYTES = 32
const NONCE_BYTES = 24
const MAX_PAYLOAD_BYTES = 16384
const MAX_BASE64_CHARS = 21848
const MAX_NAME_CODE_POINTS = 128
const MAX_URI_BYTES = 2048
const FIELD_PRIME = 2n ** 255n - 19n

// "expand 32-byte k"
const SIGMA = Uint32Array.of(0x61707865, 0x3320646e, 0x79622d32, 0x6b206574)

/** Standard base64: the `+/` alphabet, `=` padding, length a multiple of 4. */
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const HTTPS_URI = /^https:\/\/(?![.-])[A-Za-z0-9.-]{1,253}(?::[0-9]{1,5})?(?:[/?#][\x21-\x7e]*)?$/
const IPFS_URI = /^ipfs:\/\/[A-Za-z0-9]+(?:\/[\x21-\x7e]*)?$/

export interface SealedToOpen {
  /** Standard padded base64 of the sealed box. */
  payload: string
}

export type OpenedInscription = { ok: true; json: string } | { ok: false; reason: 'unreadable' }

const UNREADABLE: OpenedInscription = { ok: false, reason: 'unreadable' }

function leToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i])
  return value
}

function bigIntToLe(value: bigint, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let rest = value
  for (let i = 0; i < length; i++) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

/**
 * True when `u` is a canonical X25519 public key of the prime-order
 * subgroup. It refuses a u-coordinate off the curve, a small-order point
 * and a point with a torsion component (mixed order), through the Edwards
 * point with the same y. Either sign of x has the same torsion status.
 */
function isPrimeOrderU(u: Uint8Array): boolean {
  if (u.length !== KEY_BYTES || (u[31] & 0x80) !== 0) return false
  const uValue = leToBigInt(u)
  if (uValue >= FIELD_PRIME) return false
  const denominator = mod(uValue + 1n, FIELD_PRIME)
  if (denominator === 0n) return false
  const y = mod((uValue - 1n) * invert(denominator, FIELD_PRIME), FIELD_PRIME)
  try {
    const point = ed25519.Point.fromBytes(bigIntToLe(y, KEY_BYTES))
    return !point.isSmallOrder() && point.isTorsionFree()
  } catch {
    return false
  }
}

/**
 * `crypto_box_seal_open` of `sealed` for the account with the Ed25519 `ownSeed`
 * and `ownPublicKey`. Returns the plaintext, or null when the box is
 * malformed, the key is refused or authentication fails.
 */
export function openSealed(
  ownSeed: Uint8Array,
  ownPublicKey: Uint8Array,
  sealed: Uint8Array
): Uint8Array | null {
  if (sealed.length < SEAL_OVERHEAD) return null
  const ephemeral = sealed.subarray(0, KEY_BYTES)
  if (!isPrimeOrderU(ephemeral)) return null

  // The X25519 secret is the first half of SHA-512(seed); x25519 clamps it.
  // The second half is the Ed25519 nonce prefix, so the whole digest is wiped.
  const digest = sha512(ownSeed)
  let shared: Uint8Array | null = null
  let key: Uint8Array | null = null
  try {
    const ownMontgomery = edwardsToMontgomeryPub(ownPublicKey)
    const nonceInput = new Uint8Array(2 * KEY_BYTES)
    nonceInput.set(ephemeral, 0)
    nonceInput.set(ownMontgomery, KEY_BYTES)
    const nonce = blake2b(nonceInput, { dkLen: NONCE_BYTES })

    shared = x25519.getSharedSecret(digest.subarray(0, 32), ephemeral)
    const derived = new Uint32Array(8)
    hsalsa(SIGMA, u32(shared), new Uint32Array(4), derived)
    key = u8(derived)
    return xsalsa20poly1305(key, nonce).decrypt(sealed.subarray(KEY_BYTES))
  } catch {
    return null
  } finally {
    digest.fill(0)
    shared?.fill(0)
    key?.fill(0)
  }
}

/**
 * Length of the content inside the ISO/IEC 7816-4 padding, or -1 when the
 * padding is invalid. Like `sodium_unpad(buf, 32)`, only the last block is
 * searched.
 */
function unpaddedLength(padded: Uint8Array): number {
  for (let i = padded.length - 1; i >= padded.length - SEAL_PAD_BLOCK; i--) {
    if (padded[i] === 0x80) return i
    if (padded[i] !== 0) return -1
  }
  return -1
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidUri(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    new TextEncoder().encode(value).length <= MAX_URI_BYTES &&
    (HTTPS_URI.test(value) || IPFS_URI.test(value))
  )
}

/**
 * True when `text` is one JSON object `{"v":1,"name"?,"image"?,"description"?,"ext"?}`
 * with the public field rules for the optional keys. Deeper strictness
 * (duplicate keys, number tokens) is left to the reader.
 */
function matchesPlaintextSchema(text: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return false
  }
  if (!isPlainObject(value) || value.v !== 1) return false
  if (value.name !== undefined) {
    if (typeof value.name !== 'string') return false
    const length = Array.from(value.name).length
    if (length > MAX_NAME_CODE_POINTS) return false
  }
  if (value.image !== undefined && !isValidUri(value.image)) return false
  if (value.description !== undefined && typeof value.description !== 'string') return false
  if (value.ext !== undefined && !isPlainObject(value.ext)) return false
  return true
}

/** Strict UTF-8 of the padded plaintext, or null when padding, UTF-8 or schema fail. */
function plaintextJson(padded: Uint8Array): string | null {
  if (padded.length === 0 || padded.length % SEAL_PAD_BLOCK !== 0) return null
  const length = unpaddedLength(padded)
  if (length < 0) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      padded.subarray(0, length)
    )
  } catch {
    return null
  }
  return matchesPlaintextSchema(text) ? text : null
}

/** Standard padded base64 to bytes, or null for any other encoding. */
function decodeStandardBase64(data: string): Uint8Array | null {
  if (!STANDARD_BASE64.test(data)) return null
  try {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
    // The unused bits of the last character must be zero: only the canonical
    // encoding of a payload is accepted.
    return btoa(String.fromCharCode(...bytes)) === data ? bytes : null
  } catch {
    return null
  }
}

/** Opens one payload. Every failure is the same `unreadable` result. */
export function openInscription(args: {
  ownSeed: Uint8Array
  ownPublicKey: Uint8Array
  payload: string
}): OpenedInscription {
  const sealed = decodeStandardBase64(args.payload)
  if (!sealed || sealed.length > MAX_PAYLOAD_BYTES) return UNREADABLE
  if ((sealed.length - SEAL_OVERHEAD) % SEAL_PAD_BLOCK !== 0) return UNREADABLE
  const padded = openSealed(args.ownSeed, args.ownPublicKey, sealed)
  if (!padded) return UNREADABLE
  try {
    const json = plaintextJson(padded)
    return json === null ? UNREADABLE : { ok: true, json }
  } finally {
    padded.fill(0)
  }
}

/** Returns why dApp params for an open batch are unusable, or null when they are fine. */
export function sealParamsProblem(params: unknown): string | null {
  if (!Array.isArray(params) || params.length < 1 || params.length > MAX_SEALED_OPEN_BATCH) {
    return `Expected an array of 1 to ${MAX_SEALED_OPEN_BATCH} inscriptions`
  }
  for (const item of params) {
    if (typeof item !== 'object' || item === null) return 'Each inscription must be an object'
    const { payload } = item as Record<string, unknown>
    if (typeof payload !== 'string' || payload.length > MAX_BASE64_CHARS) {
      return 'payload must be a base64 string of at most 21848 characters'
    }
  }
  return null
}

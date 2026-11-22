import { Buffer } from 'buffer'
import { addNumberDecimals, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { PendingApproval } from './dapp-approvals'
import { decodeContractCall, isEmbeddedContract } from './contract-call'
import { messageSegments } from './message-guard'
import type { MessageSegment } from './message-guard'

export function coreTokenSymbol(tokenStandard: string): 'ZNN' | 'QSR' | null {
  if (tokenStandard === ZNN_ZTS.toString()) return 'ZNN'
  if (tokenStandard === QSR_ZTS.toString()) return 'QSR'
  return null
}

export function formatApprovalAmount(
  amount: bigint | string | number,
  tokenStandard: string
): string {
  const symbol = coreTokenSymbol(tokenStandard)
  if (symbol) return `${addNumberDecimals(amount, 8)} ${symbol}`
  return `${amount} raw units (${tokenStandard})`
}

// Every byte that will be signed and published, shown alongside any decoded
// view so nothing is hidden at approval time.
export function approvalDataHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex')
}

// A remote icon is fetched from this privileged page, which tells its host
// the user's IP and when the request was shown. So a WalletConnect peer the
// user has not connected to yet gets no icon. An in-page request's icon is
// the tab's favicon, which the browser has already loaded.
export function approvalPeerIcon(approval: PendingApproval): string | null {
  if (approval.surface === 'walletconnect' && approval.action.kind === 'connect') return null
  const icon = approval.peer.icons[0]
  return icon && icon.startsWith('https://') ? icon : null
}

export interface DecodedCallView {
  contract: string
  method: string
  args: Array<{ name: string; parts: MessageSegment[] }>
}

// Argument values come from the dApp, so they are split into segments the
// same way as a signed message: invisible and reordering code points show as
// U+XXXX labels.
export function decodedCallView(toAddress: string, data: Uint8Array): DecodedCallView | null {
  const call = decodeContractCall(toAddress, data)
  if (!call) return null
  return {
    ...call,
    args: call.args.map((arg) => ({ name: arg.name, parts: messageSegments(arg.value) })),
  }
}

// Caps so a hostile payload cannot freeze the window: the scan, the parse
// and the pretty-print only run inside them.
export const MAX_JSON_DEPTH = 16
export const MAX_JSON_TOKENS = 2000

export interface DataTextView {
  /** The text as shown: pretty-printed when `json` is true. */
  parts: MessageSegment[]
  json: boolean
  hiddenCharCount: number
}

/**
 * Compact form of `text` with the whitespace outside strings removed, or
 * null when it nests deeper or holds more separators than the caps allow.
 */
function compactJson(text: string): string | null {
  let out = ''
  let depth = 0
  let tokens = 0
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === ' ' || char === '\n' || char === '\r' || char === '\t') continue
    if (char === '"') inString = true
    else if (char === '{' || char === '[') {
      if (++depth > MAX_JSON_DEPTH) return null
    } else if (char === '}' || char === ']') depth--
    else if ((char === ',' || char === ':') && ++tokens > MAX_JSON_TOKENS) return null
    out += char
  }
  return out
}

/**
 * Pretty-printed `text` when it is a JSON object that the pretty print
 * reproduces exactly (so a duplicate key, a big number or an escape is
 * never silently rewritten), else null.
 */
function prettyJsonObject(text: string): string | null {
  if (!text.trimStart().startsWith('{')) return null
  const compact = compactJson(text)
  if (compact === null) return null
  try {
    const value: unknown = JSON.parse(compact)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return JSON.stringify(value) === compact ? JSON.stringify(value, null, 2) : null
  } catch {
    return null
  }
}

/**
 * The readable form of a send's `data`, or null when the data is not text
 * to show: empty, an embedded contract destination (a contract call) or
 * not well-formed UTF-8. Hidden code points show as U+XXXX labels.
 */
export function dataTextView(toAddress: string, data: Uint8Array): DataTextView | null {
  if (data.length === 0 || isEmbeddedContract(toAddress)) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data)
  } catch {
    return null
  }
  const pretty = prettyJsonObject(text)
  const parts = messageSegments(pretty ?? text)
  return {
    parts,
    json: pretty !== null,
    hiddenCharCount: parts.filter((part) => part.hidden).length,
  }
}

/**
 * Pure, dependency-free rules for what a dApp may ask the wallet to sign as a
 * message. No imports at all, so this module runs unchanged in the page, a
 * content script and the service worker — `TextEncoder` is a platform global
 * in all three.
 */

/** Both limits are measured in UTF-8 bytes, never characters. */
export const MAX_MESSAGE_LENGTH = 8192
export const BLOCK_HASH_LENGTH = 32

/** Thrown by the page-side parsers and signer when a dApp's params are unusable. */
export class InvalidParamsError extends Error {}

/** UTF-8. See message-signing.ts for the interop rationale. */
export function encodeMessage(message: string): Uint8Array {
  return new TextEncoder().encode(message)
}

// TextEncoder turns an unpaired surrogate into U+FFFD, so the signed bytes
// would not match the string the dialog shows.
const UNPAIRED_SURROGATE = /\p{Cs}/u

// Code points that render as nothing, reorder the text around them, or break
// a line without looking like a newline: controls (except \n and \t),
// format characters (bidi controls, zero-width characters, BOM, soft hyphen)
// and the Unicode line/paragraph separators.
const HIDDEN_CODE_POINT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

export interface MessageSegment {
  text: string
  /** true when `text` is a `U+XXXX` label standing in for a hidden code point */
  hidden: boolean
}

/**
 * Splits a message for display so every code point that would be invisible
 * or reorder the text is shown as a `U+XXXX` label instead. The dialog
 * renders the segments with `white-space: pre-wrap`, so what the user reads
 * maps one to one onto the bytes that get signed.
 */
export function messageSegments(message: string): MessageSegment[] {
  const segments: MessageSegment[] = []
  let plain = ''
  for (const char of message) {
    if (char !== '\n' && char !== '\t' && HIDDEN_CODE_POINT.test(char)) {
      if (plain) segments.push({ text: plain, hidden: false })
      plain = ''
      const codePoint = (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')
      segments.push({ text: `U+${codePoint}`, hidden: true })
    } else {
      plain += char
    }
  }
  if (plain) segments.push({ text: plain, hidden: false })
  return segments
}

/** null when the message is signable, else the user-facing reason. */
export function messageProblem(message: unknown): string | null {
  if (typeof message !== 'string') return 'Message must be a string.'
  if (message.length === 0) return 'Message must not be empty.'
  if (UNPAIRED_SURROGATE.test(message)) {
    return 'Message contains an unpaired UTF-16 surrogate and cannot be signed as shown.'
  }

  const bytes = encodeMessage(message).length

  if (bytes > MAX_MESSAGE_LENGTH) {
    return `Message is too long (${bytes} bytes, maximum ${MAX_MESSAGE_LENGTH}).`
  }

  if (bytes === BLOCK_HASH_LENGTH) {
    return 'A 32-byte message is the size of an account block hash and cannot be signed. Add or remove a character.'
  }

  return null
}

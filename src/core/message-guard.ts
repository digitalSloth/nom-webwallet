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

/** null when the message is signable, else the user-facing reason. */
export function messageProblem(message: unknown): string | null {
  if (typeof message !== 'string') return 'Message must be a string.'
  if (message.length === 0) return 'Message must not be empty.'

  const bytes = encodeMessage(message).length

  if (bytes > MAX_MESSAGE_LENGTH) {
    return `Message is too long (${bytes} bytes, maximum ${MAX_MESSAGE_LENGTH}).`
  }

  if (bytes === BLOCK_HASH_LENGTH) {
    return 'A 32-byte message is the size of an account block hash and cannot be signed. Add or remove a character.'
  }

  return null
}

/**
 * Encrypted message envelope v1: a `crypto_box_easy` (X25519, XSalsa20,
 * Poly1305) box built from noble primitives, framed by a marker and a
 * version byte. Format reference: docs/ENCRYPTED_MESSAGES.md.
 *
 * Pure and SDK-free, so the service worker can import it. The only
 * imports are noble primitives.
 */
import { addressProblem } from './account-block-validation'
import { xsalsa20poly1305, hsalsa } from '@noble/ciphers/salsa'
import { u32, u8 } from '@noble/ciphers/utils'
import { ed25519, edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { sha512 } from '@noble/hashes/sha2'

export const MESSAGE_MARKER = Uint8Array.of(0xff, 0x7a, 0x6d, 0x73)
export const MESSAGE_VERSION = 1
/** Marker 4 + version 1 + nonce 24 + tag 16. */
export const MESSAGE_OVERHEAD = 45
export const MESSAGE_PAD_BLOCK = 32
export const MIN_ENVELOPE_BYTES = 77
export const MAX_ENVELOPE_BYTES = 16384
/** Largest envelope whose base plasma PoW alone can cover (94,500). */
export const POW_MAX_ENVELOPE_BYTES = 1080
export const MAX_OPEN_BATCH = 50

const NONCE_BYTES = 24
const TAG_BYTES = 16
const HASH_BYTES = 32
const FLAG_WRITER_LOWER = 0b01
const FLAG_REPLY = 0b10
const MAX_BASE64_CHARS = 21848
const BASE_PLASMA = 21000
const PLASMA_PER_BYTE = 68

export interface MessageContent {
  body: string
  /** Lower-case hex block hash of the parent message, or null. */
  replyTo: string | null
}

export interface MessageToOpen {
  /** Base64 block data. */
  data: string
  /** Counterparty Ed25519 public key, hex. */
  publicKey: string
  /** True when the account being read wrote the block. */
  outgoing: boolean
}

export type OpenedMessage =
  | ({ ok: true } & MessageContent)
  | { ok: false; reason: 'notMessage' | 'unsupportedVersion' | 'unreadable' }

// "expand 32-byte k"
const SIGMA = Uint32Array.of(0x61707865, 0x3320646e, 0x79622d32, 0x6b206574)

// An unpaired surrogate would become U+FFFD under TextEncoder.
const UNPAIRED_SURROGATE = /\p{Cs}/u
const HASH_HEX = /^[0-9a-f]{64}$/
const PUBLIC_KEY_HEX = /^[0-9a-fA-F]{64}$/
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const encoder = new TextEncoder()

function contentLength(body: Uint8Array, replyTo: string | null): number {
  return 1 + (replyTo === null ? 0 : HASH_BYTES) + body.length
}

function paddedLength(contentBytes: number): number {
  return (Math.floor(contentBytes / MESSAGE_PAD_BLOCK) + 1) * MESSAGE_PAD_BLOCK
}

/** Returns why the content cannot be sealed, or null when it can. */
export function contentProblem(content: MessageContent): string | null {
  if (UNPAIRED_SURROGATE.test(content.body)) return 'Text contains an unpaired surrogate'
  const body = encoder.encode(content.body)
  if (body.length === 0) return 'Body is empty'
  if (content.replyTo !== null && !HASH_HEX.test(content.replyTo)) {
    return 'replyTo must be 64 lower-case hex characters'
  }
  if (MESSAGE_OVERHEAD + paddedLength(contentLength(body, content.replyTo)) > MAX_ENVELOPE_BYTES) {
    return `Message is longer than ${MAX_ENVELOPE_BYTES} bytes once sealed`
  }
  return null
}

/** Sealed size in bytes. Call only for content with no `contentProblem`. */
export function envelopeLength(content: MessageContent): number {
  const body = encoder.encode(content.body)
  return MESSAGE_OVERHEAD + paddedLength(contentLength(body, content.replyTo))
}

/** Plasma of a send block with `envelopeBytes` of data, before any price floor. */
export function basePlasma(envelopeBytes: number): number {
  return BASE_PLASMA + PLASMA_PER_BYTE * envelopeBytes
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** True when `a` sorts below `b`: first differing unsigned byte decides, equal is false. */
function sortsBelow(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/**
 * Refuses the keys `crypto_sign_ed25519_pk_to_curve25519` refuses: a
 * non-canonical encoding, a small-order point and a point with a torsion
 * component. The clamped X25519 scalar would erase a torsion component, so
 * two different addresses would share one box key.
 */
function checkCounterpartyKey(publicKey: Uint8Array): void {
  const point = ed25519.Point.fromBytes(publicKey)
  if (point.isSmallOrder() || !point.isTorsionFree()) throw new Error('Unusable public key')
}

/** `crypto_box_beforenm` over the Ed25519 keys converted to X25519. */
function boxKey(ownSeed: Uint8Array, counterpartyPublicKey: Uint8Array): Uint8Array {
  checkCounterpartyKey(counterpartyPublicKey)
  // The X25519 secret is the first half of SHA-512(seed); x25519 clamps it.
  // The second half is the Ed25519 nonce prefix, so the whole digest is wiped.
  const digest = sha512(ownSeed)
  try {
    const shared = x25519.getSharedSecret(
      digest.subarray(0, 32),
      edwardsToMontgomeryPub(counterpartyPublicKey)
    )
    try {
      const key = new Uint32Array(8)
      hsalsa(SIGMA, u32(shared), new Uint32Array(4), key)
      return u8(key)
    } finally {
      shared.fill(0)
    }
  } finally {
    digest.fill(0)
  }
}

export function sealMessage(args: {
  ownSeed: Uint8Array
  ownPublicKey: Uint8Array
  counterpartyPublicKey: Uint8Array
  content: MessageContent
}): Uint8Array {
  const problem = contentProblem(args.content)
  if (problem) throw new Error(problem)

  const body = encoder.encode(args.content.body)
  const replyTo = args.content.replyTo
  const flags =
    (sortsBelow(args.ownPublicKey, args.counterpartyPublicKey) ? FLAG_WRITER_LOWER : 0) |
    (replyTo === null ? 0 : FLAG_REPLY)

  const padded = new Uint8Array(paddedLength(contentLength(body, replyTo)))
  let at = 0
  padded[at++] = flags
  if (replyTo !== null) {
    padded.set(hexToBytes(replyTo), at)
    at += HASH_BYTES
  }
  padded.set(body, at)
  at += body.length
  padded[at] = 0x80

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))

  const key = boxKey(args.ownSeed, args.counterpartyPublicKey)
  try {
    const boxed = xsalsa20poly1305(key, nonce).encrypt(padded)
    const envelope = new Uint8Array(MESSAGE_OVERHEAD - TAG_BYTES + boxed.length)
    envelope.set(MESSAGE_MARKER, 0)
    envelope[MESSAGE_MARKER.length] = MESSAGE_VERSION
    envelope.set(nonce, MESSAGE_MARKER.length + 1)
    envelope.set(boxed, MESSAGE_MARKER.length + 1 + NONCE_BYTES)
    return envelope
  } finally {
    key.fill(0)
  }
}

const UNREADABLE: OpenedMessage = { ok: false, reason: 'unreadable' }

/**
 * Length of the content inside the padding, or -1 when the padding is
 * invalid. Like `sodium_unpad(buf, 32)`, only the last block is searched.
 */
function unpaddedLength(padded: Uint8Array): number {
  for (let i = padded.length - 1; i >= padded.length - MESSAGE_PAD_BLOCK; i--) {
    if (padded[i] === 0x80) return i
    if (padded[i] !== 0) return -1
  }
  return -1
}

function parseContent(content: Uint8Array, expectWriterLower: boolean): OpenedMessage {
  if (content.length < 2) return UNREADABLE
  const flags = content[0]
  if (flags & ~(FLAG_WRITER_LOWER | FLAG_REPLY)) return UNREADABLE
  if (((flags & FLAG_WRITER_LOWER) !== 0) !== expectWriterLower) return UNREADABLE

  let at = 1
  let replyTo: string | null = null
  if (flags & FLAG_REPLY) {
    if (content.length < at + HASH_BYTES + 1) return UNREADABLE
    replyTo = bytesToHex(content.subarray(at, at + HASH_BYTES))
    at += HASH_BYTES
  }

  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
    return { ok: true, body: decoder.decode(content.subarray(at)), replyTo }
  } catch {
    return UNREADABLE
  }
}

export function openMessage(args: {
  ownSeed: Uint8Array
  ownPublicKey: Uint8Array
  counterpartyPublicKey: Uint8Array
  envelope: Uint8Array
  outgoing: boolean
}): OpenedMessage {
  const { envelope } = args
  if (envelope.length < MESSAGE_MARKER.length + 1) return { ok: false, reason: 'notMessage' }
  for (let i = 0; i < MESSAGE_MARKER.length; i++) {
    if (envelope[i] !== MESSAGE_MARKER[i]) return { ok: false, reason: 'notMessage' }
  }
  if (envelope[MESSAGE_MARKER.length] !== MESSAGE_VERSION) {
    return { ok: false, reason: 'unsupportedVersion' }
  }
  if (
    envelope.length < MIN_ENVELOPE_BYTES ||
    (envelope.length - MESSAGE_OVERHEAD) % MESSAGE_PAD_BLOCK !== 0
  ) {
    return UNREADABLE
  }

  const writer = args.outgoing ? args.ownPublicKey : args.counterpartyPublicKey
  const reader = args.outgoing ? args.counterpartyPublicKey : args.ownPublicKey

  let key: Uint8Array | null = null
  try {
    key = boxKey(args.ownSeed, args.counterpartyPublicKey)
    const nonceAt = MESSAGE_MARKER.length + 1
    const nonce = envelope.subarray(nonceAt, nonceAt + NONCE_BYTES)
    const padded = xsalsa20poly1305(key, nonce).decrypt(envelope.subarray(nonceAt + NONCE_BYTES))
    const length = unpaddedLength(padded)
    if (length < 0) return UNREADABLE
    return parseContent(padded.subarray(0, length), sortsBelow(writer, reader))
  } catch {
    return UNREADABLE
  } finally {
    key?.fill(0)
  }
}

/** Returns why dApp params for an open batch are unusable, or null when they are fine. */
export function openParamsProblem(params: unknown): string | null {
  if (!Array.isArray(params) || params.length < 1 || params.length > MAX_OPEN_BATCH) {
    return `Expected an array of 1 to ${MAX_OPEN_BATCH} messages`
  }
  for (const item of params) {
    if (typeof item !== 'object' || item === null) return 'Each message must be an object'
    const { data, publicKey, outgoing } = item as Record<string, unknown>
    if (typeof data !== 'string' || data.length > MAX_BASE64_CHARS || !BASE64.test(data)) {
      return 'data must be base64 of at most 21848 characters'
    }
    if (typeof publicKey !== 'string' || !PUBLIC_KEY_HEX.test(publicKey)) {
      return 'publicKey must be 64 hex characters'
    }
    if (typeof outgoing !== 'boolean') return 'outgoing must be a boolean'
  }
  return null
}

export interface EncryptedMessageParams {
  to: string
  /** Recipient Ed25519 public key, 64 hex. */
  publicKey: string
  body: string
  /** Parent message block hash, 64 hex. */
  replyTo?: string
}

export interface EncryptedMessageRequest {
  to: string
  /** Recipient Ed25519 public key, 64 hex. */
  publicKey: string
  content: MessageContent
}

/** Returns why dApp params for a send are unusable, or null when they are fine. */
export function encryptedMessageParamsProblem(params: unknown): string | null {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return 'Params must be an object'
  }
  const { to, publicKey, body, replyTo } = params as Record<string, unknown>
  const toProblem = addressProblem(to)
  if (toProblem) return toProblem
  if (typeof publicKey !== 'string' || !PUBLIC_KEY_HEX.test(publicKey)) {
    return 'publicKey must be 64 hex characters'
  }
  if (typeof body !== 'string') return 'body must be a string'
  if (replyTo !== undefined && (typeof replyTo !== 'string' || !PUBLIC_KEY_HEX.test(replyTo))) {
    return 'replyTo must be 64 hex characters'
  }
  return contentProblem(normalisedContent(params as Record<string, unknown>))
}

function normalisedContent(params: Record<string, unknown>): MessageContent {
  return {
    body: params.body as string,
    replyTo: params.replyTo === undefined ? null : (params.replyTo as string).toLowerCase(),
  }
}

/** The request behind params that passed `encryptedMessageParamsProblem`. */
export function encryptedMessageRequest(params: unknown): EncryptedMessageRequest {
  const p = params as Record<string, unknown>
  return {
    to: p.to as string,
    publicKey: (p.publicKey as string).toLowerCase(),
    content: normalisedContent(p),
  }
}

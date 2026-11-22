import {
  ED25519_TORSION_SUBGROUP,
  ed25519,
  edwardsToMontgomeryPub,
  x25519,
} from '@noble/curves/ed25519'
import { sha512 } from '@noble/hashes/sha2'
import sodium from 'libsodium-wrappers'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import vector from '@/core/message-envelope.vector.json'
import {
  MAX_ENVELOPE_BYTES,
  MAX_OPEN_BATCH,
  POW_MAX_ENVELOPE_BYTES,
  basePlasma,
  contentProblem,
  encryptedMessageParamsProblem,
  encryptedMessageRequest,
  envelopeLength,
  openMessage,
  openParamsProblem,
  sealMessage,
  type MessageContent,
} from '@/core/message-envelope'

const MARKER = [0xff, 0x7a, 0x6d, 0x73]

let hex: (bytes: Uint8Array) => string
let fromHex: (text: string) => Uint8Array

interface Party {
  seed: Uint8Array
  publicKey: Uint8Array
  secretKey: Uint8Array
}

const sender: Party = {
  seed: new Uint8Array(),
  publicKey: new Uint8Array(),
  secretKey: new Uint8Array(),
}
const recipient: Party = {
  seed: new Uint8Array(),
  publicKey: new Uint8Array(),
  secretKey: new Uint8Array(),
}
let nonce: Uint8Array
let content: MessageContent

beforeAll(async () => {
  await sodium.ready
  hex = sodium.to_hex
  fromHex = sodium.from_hex
  const load = (party: Party, seedHex: string) => {
    party.seed = fromHex(seedHex)
    const pair = sodium.crypto_sign_seed_keypair(party.seed)
    party.publicKey = pair.publicKey
    party.secretKey = pair.privateKey
  }
  load(sender, vector.senderSeed)
  load(recipient, vector.recipientSeed)
  nonce = fromHex(vector.nonce)
  content = { body: vector.body, replyTo: vector.replyTo }
})

const lower = (a: Uint8Array, b: Uint8Array) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
  return false
}

/** libsodium box of hand-made padded content, framed as an envelope. */
function sodiumEnvelope(padded: Uint8Array, version = 1): Uint8Array {
  const boxed = sodium.crypto_box_easy(
    padded,
    nonce,
    sodium.crypto_sign_ed25519_pk_to_curve25519(recipient.publicKey),
    sodium.crypto_sign_ed25519_sk_to_curve25519(sender.secretKey)
  )
  return Uint8Array.from([...MARKER, version, ...nonce, ...boxed])
}

const asRecipient = (envelope: Uint8Array) =>
  openMessage({
    ownSeed: recipient.seed,
    ownPublicKey: recipient.publicKey,
    counterpartyPublicKey: sender.publicKey,
    envelope,
    outgoing: false,
  })

const asSender = (envelope: Uint8Array) =>
  openMessage({
    ownSeed: sender.seed,
    ownPublicKey: sender.publicKey,
    counterpartyPublicKey: recipient.publicKey,
    envelope,
    outgoing: true,
  })

/** Makes the next `crypto.getRandomValues` call fill the buffer with `value`. */
function stubNonce(value: Uint8Array) {
  vi.spyOn(crypto, 'getRandomValues').mockImplementationOnce(((array: ArrayBufferView) => {
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(value)
    return array
  }) as typeof crypto.getRandomValues)
}

/** Seals as the vector sender; `withNonce` replaces the random nonce draw. */
const seal = (value: MessageContent, withNonce?: Uint8Array) => {
  if (withNonce) {
    stubNonce(withNonce)
  }
  return sealMessage({
    ownSeed: sender.seed,
    ownPublicKey: sender.publicKey,
    counterpartyPublicKey: recipient.publicKey,
    content: value,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

const unreadable = { ok: false, reason: 'unreadable' }

const bytesHex = (bytes: Uint8Array) => sodium.to_hex(bytes)

describe('vector', () => {
  it('is reproduced byte for byte by libsodium from its inputs', () => {
    const enc = new TextEncoder()
    const body = enc.encode(vector.body)
    const flags = (lower(sender.publicKey, recipient.publicKey) ? 1 : 0) | 2
    const raw = Uint8Array.from([flags, ...new Uint8Array(32).fill(0xab), ...body])
    const padded = sodium.pad(raw, 32)

    expect(hex(sender.publicKey)).toBe(vector.senderPublicKey)
    expect(hex(recipient.publicKey)).toBe(vector.recipientPublicKey)
    expect(flags).toBe(vector.flags)
    expect(hex(raw)).toBe(vector.content)
    expect(hex(padded)).toBe(vector.padded)
    expect(hex(sodiumEnvelope(padded))).toBe(vector.envelope)
    expect(Buffer.from(sodiumEnvelope(padded)).toString('base64')).toBe(vector.envelopeBase64)
    expect(vector.envelopeLength).toBe(141)
    expect(vector.basePlasma).toBe(30588)
  })
})

describe('sealMessage', () => {
  it('equals the vector envelope for the vector seeds and nonce', () => {
    expect(hex(seal(content, nonce))).toBe(vector.envelope)
  })

  it('produces an envelope libsodium opens', () => {
    const envelope = seal(content, nonce)
    const plain = sodium.crypto_box_open_easy(
      envelope.subarray(29),
      envelope.subarray(5, 29),
      sodium.crypto_sign_ed25519_pk_to_curve25519(sender.publicKey),
      sodium.crypto_sign_ed25519_sk_to_curve25519(recipient.secretKey)
    )
    expect(hex(sodium.unpad(plain, 32))).toBe(vector.content)
  })

  it('opens an envelope libsodium sealed', () => {
    const raw = fromHex(vector.content)
    const envelope = sodiumEnvelope(sodium.pad(raw, 32))
    expect(asRecipient(envelope)).toEqual({ ok: true, ...content })
  })

  it('throws on content with a problem', () => {
    expect(() => seal({ body: '', replyTo: null })).toThrow('Body is empty')
  })

  it('draws a fresh nonce for every message', () => {
    expect(hex(seal(content))).not.toBe(hex(seal(content)))
  })
})

describe('key conversion', () => {
  it('matches libsodium for both vector keys', () => {
    for (const party of [sender, recipient]) {
      expect(hex(edwardsToMontgomeryPub(party.publicKey))).toBe(
        hex(sodium.crypto_sign_ed25519_pk_to_curve25519(party.publicKey))
      )
      const scalar = sha512(party.seed).subarray(0, 32)
      expect(hex(x25519.getPublicKey(scalar))).toBe(
        hex(
          sodium.crypto_scalarmult_base(
            sodium.crypto_sign_ed25519_sk_to_curve25519(party.secretKey)
          )
        )
      )
    }
  })
})

describe('openMessage', () => {
  const envelope = () => fromHex(vector.envelope)

  it('returns the content to the recipient and the sender', () => {
    const expected = { ok: true, body: vector.body, replyTo: vector.replyTo }
    expect(asRecipient(envelope())).toEqual(expected)
    expect(asSender(envelope())).toEqual(expected)
  })

  it('returns a null replyTo when no reply hash is present', () => {
    const sealed = seal({ body: 'hi', replyTo: null })
    expect(asRecipient(sealed)).toEqual({ ok: true, body: 'hi', replyTo: null })
  })

  it('refuses a flipped ciphertext byte', () => {
    const bad = envelope()
    bad[50] ^= 1
    expect(asRecipient(bad)).toEqual(unreadable)
  })

  it('refuses a flipped tag byte', () => {
    const bad = envelope()
    bad[30] ^= 1
    expect(asRecipient(bad)).toEqual(unreadable)
  })

  it('refuses when the caller states the wrong writer', () => {
    expect(
      openMessage({
        ownSeed: recipient.seed,
        ownPublicKey: recipient.publicKey,
        counterpartyPublicKey: sender.publicKey,
        envelope: envelope(),
        outgoing: true,
      })
    ).toEqual(unreadable)
    expect(
      openMessage({
        ownSeed: sender.seed,
        ownPublicKey: sender.publicKey,
        counterpartyPublicKey: recipient.publicKey,
        envelope: envelope(),
        outgoing: false,
      })
    ).toEqual(unreadable)
  })

  it('refuses a wrong counterparty key', () => {
    const other = sodium.crypto_sign_seed_keypair(new Uint8Array(32).fill(9))
    expect(
      openMessage({
        ownSeed: recipient.seed,
        ownPublicKey: recipient.publicKey,
        counterpartyPublicKey: other.publicKey,
        envelope: envelope(),
        outgoing: false,
      })
    ).toEqual(unreadable)
  })

  it('refuses a low-order counterparty key', () => {
    const zero = new Uint8Array(32)
    zero[0] = 1
    expect(
      openMessage({
        ownSeed: recipient.seed,
        ownPublicKey: recipient.publicKey,
        counterpartyPublicKey: zero,
        envelope: envelope(),
        outgoing: false,
      })
    ).toEqual(unreadable)
  })

  it('refuses bad lengths', () => {
    expect(asRecipient(envelope().subarray(0, 76))).toEqual(unreadable)
    expect(asRecipient(envelope().subarray(0, 140))).toEqual(unreadable)
    expect(asRecipient(Uint8Array.from([...envelope(), 0]))).toEqual(unreadable)
  })

  const tail = (...bytes: number[]) => Uint8Array.from(bytes)
  const pad32 = (bytes: Uint8Array) => sodium.pad(bytes, 32)
  const writerFlag = () => (lower(sender.publicKey, recipient.publicKey) ? 1 : 0)
  const text = (value: string) => new TextEncoder().encode(value)

  it('refuses invalid padding', () => {
    const noTerminator = new Uint8Array(32).fill(0)
    noTerminator.set([writerFlag(), 0x61])
    const junkAfter = pad32(tail(writerFlag(), 0x61))
    junkAfter[31] = 1
    expect(asRecipient(sodiumEnvelope(noTerminator))).toEqual(unreadable)
    expect(asRecipient(sodiumEnvelope(junkAfter))).toEqual(unreadable)
  })

  it('refuses reserved flag bits', () => {
    const raw = pad32(tail(writerFlag() | 0b100, 0x61))
    expect(asRecipient(sodiumEnvelope(raw))).toEqual(unreadable)
  })

  it('refuses a flag bit 0 that disagrees with the writer', () => {
    const raw = pad32(tail(writerFlag() ^ 1, 0x61))
    expect(asRecipient(sodiumEnvelope(raw))).toEqual(unreadable)
  })

  it('refuses padding that spans more than one block', () => {
    const raw = new Uint8Array(96)
    raw.set([writerFlag(), 0x61, 0x80])
    expect(() => sodium.unpad(raw, 32)).toThrow()
    expect(asRecipient(sodiumEnvelope(raw))).toEqual(unreadable)
  })

  it('keeps a leading byte order mark in the body', () => {
    const bom = [0xef, 0xbb, 0xbf]
    const raw = pad32(tail(writerFlag(), ...bom, 0x62))
    expect(asRecipient(sodiumEnvelope(raw))).toEqual({
      ok: true,
      body: '\ufeffb',
      replyTo: null,
    })
  })

  it('refuses an empty body', () => {
    const raw = pad32(tail(writerFlag()))
    expect(asRecipient(sodiumEnvelope(raw))).toEqual(unreadable)
  })

  it('refuses a reply flag with no room for the hash', () => {
    const raw = pad32(tail(writerFlag() | 2, 0xab))
    expect(asRecipient(sodiumEnvelope(raw))).toEqual(unreadable)
  })

  it('refuses invalid UTF-8 in the body', () => {
    const badBody = pad32(tail(writerFlag(), 0xc3, 0x28))
    expect(asRecipient(sodiumEnvelope(badBody))).toEqual(unreadable)
    expect(asRecipient(sodiumEnvelope(pad32(tail(writerFlag(), ...text('ok')))))).toEqual({
      ok: true,
      body: 'ok',
      replyTo: null,
    })
  })

  it('returns notMessage for other data', () => {
    expect(asRecipient(new Uint8Array())).toEqual({ ok: false, reason: 'notMessage' })
    expect(asRecipient(Uint8Array.from(MARKER))).toEqual({ ok: false, reason: 'notMessage' })
    expect(asRecipient(text('hello world, plain memo'))).toEqual({
      ok: false,
      reason: 'notMessage',
    })
  })

  it('returns unsupportedVersion for version 02', () => {
    const bad = envelope()
    bad[4] = 2
    expect(asRecipient(bad)).toEqual({ ok: false, reason: 'unsupportedVersion' })
  })

  it('opens a self-message as outgoing and as incoming', () => {
    const own = { ownSeed: sender.seed, ownPublicKey: sender.publicKey }
    const sealed = sealMessage({
      ...own,
      counterpartyPublicKey: sender.publicKey,
      content: { body: 'to me', replyTo: null },
    })
    const expected = { ok: true, body: 'to me', replyTo: null }
    for (const outgoing of [true, false]) {
      expect(
        openMessage({ ...own, counterpartyPublicKey: sender.publicKey, envelope: sealed, outgoing })
      ).toEqual(expected)
    }
  })
})

describe('keys libsodium refuses', () => {
  const torsion = ED25519_TORSION_SUBGROUP.map((h) => ed25519.Point.fromHex(h)).filter(
    (p) => !p.is0()
  )
  const mixedOrder = (key: Uint8Array) =>
    torsion.map((t) => ed25519.Point.fromBytes(key).add(t).toBytes())

  it('refuses a recipient key with a torsion component on seal and open', () => {
    for (const bad of mixedOrder(recipient.publicKey)) {
      expect(() => sodium.crypto_sign_ed25519_pk_to_curve25519(bad)).toThrow()
      expect(() =>
        sealMessage({
          ownSeed: sender.seed,
          ownPublicKey: sender.publicKey,
          counterpartyPublicKey: bad,
          content,
        })
      ).toThrow()
      expect(
        openMessage({
          ownSeed: sender.seed,
          ownPublicKey: sender.publicKey,
          counterpartyPublicKey: bad,
          envelope: fromHex(vector.envelope),
          outgoing: true,
        })
      ).toEqual(unreadable)
    }
  })

  it('does not open a reflected envelope from a mixed-order twin of the recipient', () => {
    const twins = mixedOrder(recipient.publicKey).filter((k) => lower(k, sender.publicKey))
    expect(twins.length).toBeGreaterThan(0)
    for (const twin of twins) {
      expect(
        openMessage({
          ownSeed: sender.seed,
          ownPublicKey: sender.publicKey,
          counterpartyPublicKey: twin,
          envelope: fromHex(vector.envelope),
          outgoing: false,
        })
      ).toEqual(unreadable)
    }
  })

  it('refuses every small-order key', () => {
    for (const small of ED25519_TORSION_SUBGROUP) {
      expect(
        openMessage({
          ownSeed: sender.seed,
          ownPublicKey: sender.publicKey,
          counterpartyPublicKey: fromHex(small),
          envelope: fromHex(vector.envelope),
          outgoing: true,
        })
      ).toEqual(unreadable)
    }
  })

  it('refuses a non-canonical encoding of the recipient key', () => {
    // The encoding of 1 + p: y is not reduced modulo p.
    const nonCanonical = fromHex('eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f')
    expect(() => sodium.crypto_sign_ed25519_pk_to_curve25519(nonCanonical)).toThrow()
    expect(
      openMessage({
        ownSeed: sender.seed,
        ownPublicKey: sender.publicKey,
        counterpartyPublicKey: nonCanonical,
        envelope: fromHex(vector.envelope),
        outgoing: true,
      })
    ).toEqual(unreadable)
  })
})

describe('libsodium equivalence on random keys', () => {
  it('seals like crypto_box_easy and opens libsodium boxes, in both directions', () => {
    const random = (n: number) => sodium.randombytes_buf(n)
    for (let round = 0; round < 200; round++) {
      const a = sodium.crypto_sign_seed_keypair(random(32))
      const b = sodium.crypto_sign_seed_keypair(random(32))
      const value: MessageContent = {
        body: 'x'.repeat(1 + ((round * 37) % 1050)),
        replyTo: round % 3 === 0 ? bytesHex(random(32)) : null,
      }
      const nonceBytes = random(24)
      const seedA = a.privateKey.slice(0, 32)
      const seedB = b.privateKey.slice(0, 32)

      stubNonce(nonceBytes)
      const sealed = sealMessage({
        ownSeed: seedA,
        ownPublicKey: a.publicKey,
        counterpartyPublicKey: b.publicKey,
        content: value,
      })

      const padded = sodium.crypto_box_open_easy(
        sealed.subarray(29),
        nonceBytes,
        sodium.crypto_sign_ed25519_pk_to_curve25519(a.publicKey),
        sodium.crypto_sign_ed25519_sk_to_curve25519(b.privateKey)
      )
      const reboxed = sodium.crypto_box_easy(
        padded,
        nonceBytes,
        sodium.crypto_sign_ed25519_pk_to_curve25519(b.publicKey),
        sodium.crypto_sign_ed25519_sk_to_curve25519(a.privateKey)
      )
      expect(hex(sealed.subarray(29))).toBe(hex(reboxed))
      expect(sealed.length).toBe(envelopeLength(value))

      const opened = openMessage({
        ownSeed: seedB,
        ownPublicKey: b.publicKey,
        counterpartyPublicKey: a.publicKey,
        envelope: sealed,
        outgoing: false,
      })
      expect(opened).toEqual({ ok: true, ...value })

      expect(hex(edwardsToMontgomeryPub(a.publicKey))).toBe(
        hex(sodium.crypto_sign_ed25519_pk_to_curve25519(a.publicKey))
      )
      expect(hex(x25519.getPublicKey(sha512(seedA).subarray(0, 32)))).toBe(
        hex(
          sodium.crypto_scalarmult_base(sodium.crypto_sign_ed25519_sk_to_curve25519(a.privateKey))
        )
      )
    }
  })
})

describe('round trip', () => {
  it.each([2, 31, 32, 33, 1023, 1024, 16319])('seals and opens content of %i bytes', (size) => {
    const value: MessageContent = { body: 'a'.repeat(size - 1), replyTo: null }
    const sealed = seal(value)

    expect(sealed.length).toBe(envelopeLength(value))
    expect(asRecipient(sealed)).toEqual({ ok: true, ...value })
    expect(asSender(sealed)).toEqual({ ok: true, ...value })
  })

  it('adds a full block when the content fills one exactly', () => {
    const value: MessageContent = { body: 'a'.repeat(31), replyTo: null }
    expect(envelopeLength(value)).toBe(45 + 64)
  })

  it('opens a sender-written message after a swap of roles', () => {
    const sealed = sealMessage({
      ownSeed: recipient.seed,
      ownPublicKey: recipient.publicKey,
      counterpartyPublicKey: sender.publicKey,
      content,
    })
    expect(asSender(sealed)).toEqual(unreadable)
    expect(
      openMessage({
        ownSeed: sender.seed,
        ownPublicKey: sender.publicKey,
        counterpartyPublicKey: recipient.publicKey,
        envelope: sealed,
        outgoing: false,
      })
    ).toEqual({ ok: true, ...content })
  })
})

describe('contentProblem', () => {
  it('accepts content of 16319 bytes and refuses 16320', () => {
    expect(contentProblem({ body: 'a'.repeat(16318), replyTo: null })).toBeNull()
    expect(contentProblem({ body: 'a'.repeat(16319), replyTo: null })).not.toBeNull()
    expect(envelopeLength({ body: 'a'.repeat(16318), replyTo: null })).toBe(MAX_ENVELOPE_BYTES - 19)
  })

  it('accepts line breaks and refuses an empty body, unpaired surrogates and a bad replyTo', () => {
    const ok: MessageContent = { body: 'b', replyTo: null }
    expect(contentProblem({ ...ok, body: 'a\r\nb\nc' })).toBeNull()
    expect(contentProblem({ ...ok, body: '' })).not.toBeNull()
    expect(contentProblem({ ...ok, body: 'a\ud800' })).not.toBeNull()
    expect(contentProblem({ ...ok, body: '\udc00' })).not.toBeNull()
    expect(contentProblem({ ...ok, replyTo: 'AB'.repeat(32) })).not.toBeNull()
    expect(contentProblem({ ...ok, replyTo: 'ab'.repeat(31) })).not.toBeNull()
    expect(contentProblem({ ...ok, replyTo: 'ab'.repeat(32) })).toBeNull()
    expect(contentProblem(ok)).toBeNull()
  })
})

describe('basePlasma', () => {
  it('prices the vector and the PoW limit', () => {
    expect(basePlasma(141)).toBe(30588)
    expect(basePlasma(POW_MAX_ENVELOPE_BYTES)).toBeLessThanOrEqual(94500)
    expect(basePlasma(POW_MAX_ENVELOPE_BYTES + 1)).toBeGreaterThan(94500)
  })
})

describe('openParamsProblem', () => {
  const item = { data: 'AAAA', publicKey: 'ab'.repeat(32), outgoing: false }

  it('accepts 1 to 50 well-formed items', () => {
    expect(openParamsProblem([item])).toBeNull()
    expect(openParamsProblem(Array(MAX_OPEN_BATCH).fill(item))).toBeNull()
  })

  it('refuses malformed params', () => {
    expect(openParamsProblem(undefined)).not.toBeNull()
    expect(openParamsProblem([])).not.toBeNull()
    expect(openParamsProblem(Array(MAX_OPEN_BATCH + 1).fill(item))).not.toBeNull()
    expect(openParamsProblem([null])).not.toBeNull()
    expect(openParamsProblem([{ ...item, data: 5 }])).not.toBeNull()
    expect(openParamsProblem([{ ...item, data: 'not base64!' }])).not.toBeNull()
    expect(openParamsProblem([{ ...item, data: 'A'.repeat(21849) }])).not.toBeNull()
    expect(openParamsProblem([{ ...item, publicKey: 'ab' }])).not.toBeNull()
    expect(openParamsProblem([{ ...item, outgoing: 'yes' }])).not.toBeNull()
  })
})

describe('encryptedMessageParamsProblem', () => {
  const valid = {
    to: vector.recipientAddress,
    publicKey: vector.recipientPublicKey,
    body: vector.body,
    replyTo: vector.replyTo,
  }

  it('accepts the vector fields and the optional fields left out', () => {
    expect(encryptedMessageParamsProblem(valid)).toBeNull()
    expect(
      encryptedMessageParamsProblem({ to: valid.to, publicKey: valid.publicKey, body: 'x' })
    ).toBeNull()
  })

  it('normalises absent fields and a replyTo in capitals', () => {
    expect(encryptedMessageRequest({ ...valid, replyTo: 'AB'.repeat(32) })).toEqual({
      to: valid.to,
      publicKey: valid.publicKey,
      content: { body: valid.body, replyTo: 'ab'.repeat(32) },
    })
  })

  it('refuses each malformed field', () => {
    for (const bad of [
      undefined,
      null,
      [],
      'x',
      { ...valid, to: 'z1nope' },
      { ...valid, to: 5 },
      { ...valid, publicKey: 'ab' },
      { ...valid, publicKey: 5 },
      { ...valid, body: 5 },
      { ...valid, body: undefined },
      { ...valid, replyTo: 'ab' },
      { ...valid, replyTo: null },
    ]) {
      expect(encryptedMessageParamsProblem(bad)).not.toBeNull()
    }
  })

  it('refuses content the envelope cannot carry', () => {
    expect(encryptedMessageParamsProblem({ ...valid, body: '' })).not.toBeNull()
    expect(encryptedMessageParamsProblem({ ...valid, body: '\ud800' })).not.toBeNull()
  })

  it('refuses a body over the 16,384 byte block limit and accepts the largest', () => {
    const noReply = { ...valid, replyTo: undefined }
    expect(encryptedMessageParamsProblem({ ...noReply, body: 'a'.repeat(16318) })).toBeNull()
    expect(encryptedMessageParamsProblem({ ...noReply, body: 'a'.repeat(16319) })).not.toBeNull()
  })
})

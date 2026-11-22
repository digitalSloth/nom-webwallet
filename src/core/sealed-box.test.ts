import { ED25519_TORSION_SUBGROUP, ed25519, edwardsToMontgomeryPub } from '@noble/curves/ed25519'
import sodium from 'libsodium-wrappers'
import { beforeAll, describe, expect, it } from 'vitest'

import vector from '@/core/sealed-box.vector.json'
import {
  MAX_SEALED_OPEN_BATCH,
  openInscription,
  openSealed,
  sealParamsProblem,
} from '@/core/sealed-box'
import { pad32, sealWithNoble } from '@/test/sealed'

const enc = new TextEncoder()
const unreadable = { ok: false, reason: 'unreadable' }
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const validJson = JSON.stringify({ v: 1, name: 'Item', ext: { a: 1 } })

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const fromHex = (text: string) => new Uint8Array(Buffer.from(text, 'hex'))

interface Account {
  seed: Uint8Array
  publicKey: Uint8Array
}

function account(): Account {
  const pair = sodium.crypto_sign_keypair()
  return { seed: pair.privateKey.slice(0, 32), publicKey: pair.publicKey }
}

function open(owner: Account, payload: string) {
  return openInscription({ ownSeed: owner.seed, ownPublicKey: owner.publicKey, payload })
}

/** libsodium box of hand-made padded plaintext, as a payload. */
function payloadOf(owner: Account, padded: Uint8Array): string {
  return b64(
    sodium.crypto_box_seal(padded, sodium.crypto_sign_ed25519_pk_to_curve25519(owner.publicKey))
  )
}

const jsonPayload = (owner: Account, json: string) =>
  payloadOf(owner, sodium.pad(enc.encode(json), 32))

beforeAll(async () => {
  await sodium.ready
})

describe('vector', () => {
  const owner = () => ({ seed: fromHex(vector.seed), publicKey: fromHex(vector.publicKey) })

  it('is reproduced by the inverse construction and opened by libsodium', () => {
    const pair = sodium.crypto_sign_seed_keypair(fromHex(vector.seed))
    expect(hex(pair.publicKey)).toBe(vector.publicKey)
    const padded = sodium.pad(enc.encode(vector.plaintext), 32)
    expect(hex(padded)).toBe(vector.padded)
    const sealed = sealWithNoble(padded, pair.publicKey, fromHex(vector.ephemeralSecret))
    expect(hex(sealed)).toBe(vector.sealed)
    expect(b64(sealed)).toBe(vector.payload)
    expect(sealed.length).toBe(vector.sealedLength)

    const opened = sodium.crypto_box_seal_open(
      sealed,
      sodium.crypto_sign_ed25519_pk_to_curve25519(pair.publicKey),
      sodium.crypto_sign_ed25519_sk_to_curve25519(pair.privateKey)
    )
    expect(hex(opened)).toBe(vector.padded)
  })

  it('opens to the plaintext JSON', () => {
    expect(open(owner(), vector.payload)).toEqual({ ok: true, json: vector.plaintext })
  })

  it('returns the padded plaintext from openSealed', () => {
    const { seed, publicKey } = owner()
    expect(hex(openSealed(seed, publicKey, fromHex(vector.sealed)) as Uint8Array)).toBe(
      vector.padded
    )
  })
})

describe('libsodium compatibility', () => {
  it('opens what libsodium sealed, over 200 random key pairs', () => {
    for (let i = 0; i < 200; i++) {
      const owner = account()
      const message = crypto.getRandomValues(new Uint8Array(i % 97))
      const sealed = sodium.crypto_box_seal(
        message,
        sodium.crypto_sign_ed25519_pk_to_curve25519(owner.publicKey)
      )
      expect(hex(openSealed(owner.seed, owner.publicKey, sealed) as Uint8Array)).toBe(hex(message))
    }
  })

  it('is opened by libsodium when sealed with the inverse construction, over 200 key pairs', () => {
    for (let i = 0; i < 200; i++) {
      const pair = sodium.crypto_sign_keypair()
      const message = crypto.getRandomValues(new Uint8Array(i % 97))
      const sealed = sealWithNoble(message, pair.publicKey)
      const opened = sodium.crypto_box_seal_open(
        sealed,
        sodium.crypto_sign_ed25519_pk_to_curve25519(pair.publicKey),
        sodium.crypto_sign_ed25519_sk_to_curve25519(pair.privateKey)
      )
      expect(hex(opened)).toBe(hex(message))
    }
  })

  it('returns null for another account, a flipped byte and a short input', () => {
    const owner = account()
    const other = account()
    const sealed = sodium.crypto_box_seal(
      enc.encode('x'),
      sodium.crypto_sign_ed25519_pk_to_curve25519(owner.publicKey)
    )
    expect(openSealed(other.seed, other.publicKey, sealed)).toBeNull()
    for (const at of [0, 31, 32, sealed.length - 1]) {
      const bad = sealed.slice()
      bad[at] ^= 1
      expect(openSealed(owner.seed, owner.publicKey, bad)).toBeNull()
    }
    expect(openSealed(owner.seed, owner.publicKey, sealed.subarray(0, 47))).toBeNull()
    expect(openSealed(owner.seed, owner.publicKey, new Uint8Array())).toBeNull()
  })
})

describe('refused ephemeral keys', () => {
  const owner = account()
  const message = pad32(enc.encode(validJson))
  const montgomery = (point: { toBytes: () => Uint8Array }) => {
    try {
      return edwardsToMontgomeryPub(point.toBytes())
    } catch {
      return null
    }
  }
  const torsion = ED25519_TORSION_SUBGROUP.map((h) => ed25519.Point.fromHex(h))
  const smallOrderU = [
    ...torsion.map(montgomery).filter((u): u is Uint8Array => u !== null),
    new Uint8Array(32),
    Uint8Array.of(1, ...new Array(31).fill(0)),
    // p - 1, p and p + 1 are non-canonical or small order encodings
    fromHex('ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'),
    fromHex('edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'),
    fromHex('eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'),
  ]

  it('refuses every small-order public key, as libsodium does', () => {
    for (const u of smallOrderU) {
      const sealed = Uint8Array.from([...u, ...new Array(48).fill(7)])
      expect(openSealed(owner.seed, owner.publicKey, sealed)).toBeNull()
    }
  })

  it('refuses a mixed-order public key that libsodium accepts', () => {
    const order8 = torsion.find((point) => !point.is0())
    // A clamped secret is its own clamp, so e is the scalar x25519 uses.
    const secret = crypto.getRandomValues(new Uint8Array(32))
    secret[0] &= 248
    secret[31] = (secret[31] & 127) | 64
    const e = BigInt('0x' + hex(secret.slice().reverse())) % ed25519.Point.Fn.ORDER
    const mixed = ed25519.Point.BASE.multiply(e).add(order8 as (typeof torsion)[0])
    expect(mixed.isTorsionFree()).toBe(false)
    const u = montgomery(mixed) as Uint8Array
    const sealed = sealWithNoble(message, owner.publicKey, secret, u)
    // Sender: [secret] * recipient. Recipient: [clamped sk] * (eG + T), where
    // the clamp erases T. So the box is valid and libsodium opens it.
    const keys = sodium.crypto_sign_seed_keypair(owner.seed)
    expect(
      sodium.crypto_box_seal_open(
        sealed,
        sodium.crypto_sign_ed25519_pk_to_curve25519(keys.publicKey),
        sodium.crypto_sign_ed25519_sk_to_curve25519(keys.privateKey)
      )
    ).toBeDefined()
    expect(openSealed(owner.seed, owner.publicKey, sealed)).toBeNull()
  })

  it('refuses a public key with the high bit set and one off the curve', () => {
    const honest = sealWithNoble(message, owner.publicKey)
    const highBit = honest.slice()
    highBit[31] |= 0x80
    expect(openSealed(owner.seed, owner.publicKey, highBit)).toBeNull()
    // u = 2 is on the twist: u^3 + 486662u^2 + u is a non-residue mod p.
    const twist = honest.slice()
    twist.set(Uint8Array.of(2, ...new Array(31).fill(0)))
    expect(openSealed(owner.seed, owner.publicKey, twist)).toBeNull()
    expect(openSealed(owner.seed, owner.publicKey, honest)).not.toBeNull()
  })
})

describe('openInscription', () => {
  const owner = account()

  it('returns the JSON text of valid content', () => {
    expect(open(owner, jsonPayload(owner, validJson))).toEqual({ ok: true, json: validJson })
  })

  it('returns unreadable for another account', () => {
    expect(open(account(), jsonPayload(owner, validJson))).toEqual(unreadable)
  })

  it('returns unreadable for a truncated or extended payload', () => {
    const sealed = Buffer.from(jsonPayload(owner, validJson), 'base64')
    for (const length of [0, 20, 47, 48, sealed.length - 1, sealed.length - 32]) {
      expect(open(owner, b64(sealed.subarray(0, length)))).toEqual(unreadable)
    }
    expect(open(owner, b64(Uint8Array.from([...sealed, 0])))).toEqual(unreadable)
  })

  it.each([
    ['url-safe', (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_')],
    ['unpadded', (s: string) => s.replace(/=+$/, '')],
    ['with whitespace', (s: string) => s.slice(0, 8) + '\n' + s.slice(8)],
    ['not base64', () => '!!!!'],
    ['empty', () => ''],
  ])('returns unreadable for a %s payload', (_name, mutate) => {
    const payload = jsonPayload(owner, validJson)
    expect(payload).toMatch(/[+/=]|[A-Za-z]/)
    expect(open(owner, mutate(payload))).toEqual(unreadable)
  })

  it('returns unreadable when the unused bits of the last character are not zero', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const payload = jsonPayload(owner, validJson)
      if (!payload.endsWith('=')) continue
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
      const at = payload.length - 2
      const bumped =
        payload.slice(0, at) +
        alphabet[(alphabet.indexOf(payload[at]) + 1) % 64] +
        payload.slice(at + 1)
      expect(open(owner, bumped)).toEqual(unreadable)
    }
  })

  describe('padding', () => {
    const cases: [string, Uint8Array][] = [
      ['no terminator', new Uint8Array(32).fill(0)],
      [
        'junk after the terminator',
        Uint8Array.from([0x7b, 0x7d, 0x80, ...new Array(28).fill(0), 1]),
      ],
      [
        'terminator more than 32 bytes from the end',
        Uint8Array.from([0x80, ...new Array(63).fill(0)]),
      ],
      ['length not a multiple of 32', Uint8Array.from([0x7b, 0x7d, 0x80, 0, 0])],
    ]
    it.each(cases)('returns unreadable with %s', (_name, padded) => {
      expect(open(owner, payloadOf(owner, padded))).toEqual(unreadable)
    })

    it('accepts content that ends exactly at a block boundary plus a full pad block', () => {
      const json = JSON.stringify({ v: 1, name: 'a'.repeat(15) })
      expect(enc.encode(json).length).toBe(32)
      expect(open(owner, jsonPayload(owner, json))).toEqual({ ok: true, json })
    })
  })

  describe('UTF-8', () => {
    it.each([
      ['a lone continuation byte', [0x80]],
      ['an overlong encoding', [0xc0, 0xaf]],
      ['an encoded surrogate', [0xed, 0xa0, 0x80]],
      ['a code point above U+10FFFF', [0xf4, 0x90, 0x80, 0x80]],
    ])('returns unreadable for %s', (_name, bad) => {
      const content = Uint8Array.from([
        ...enc.encode('{"v":1,"name":"'),
        ...bad,
        ...enc.encode('"}'),
      ])
      expect(open(owner, payloadOf(owner, sodium.pad(content, 32)))).toEqual(unreadable)
    })

    it('returns unreadable for a byte order mark', () => {
      const content = Uint8Array.from([0xef, 0xbb, 0xbf, ...enc.encode(validJson)])
      expect(open(owner, payloadOf(owner, sodium.pad(content, 32)))).toEqual(unreadable)
    })

    it('keeps multi-byte text', () => {
      const json = JSON.stringify({ v: 1, name: 'Zenon \u{1F31F} é' })
      expect(open(owner, jsonPayload(owner, json))).toEqual({ ok: true, json })
    })
  })

  describe('schema', () => {
    const bad: [string, unknown][] = [
      ['not JSON', 'nope'],
      ['an array', [1]],
      ['a scalar', 1],
      ['null', null],
      ['no version', { name: 'x' }],
      ['version 2', { v: 2 }],
      ['a string version', { v: '1' }],
      ['a numeric name', { v: 1, name: 5 }],
      ['a name over 128 code points', { v: 1, name: 'a'.repeat(129) }],
      ['an http image', { v: 1, image: 'http://example.com/a.png' }],
      ['an inline image', { v: 1, image: 'data:image/png;base64,AAAA' }],
      ['an image with a space', { v: 1, image: 'https://example.com/a b' }],
      ['a numeric description', { v: 1, description: 5 }],
      ['an array ext', { v: 1, ext: [] }],
      ['a null ext', { v: 1, ext: null }],
    ]
    it.each(bad)('returns unreadable for %s', (_name, value) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      expect(open(owner, jsonPayload(owner, text))).toEqual(unreadable)
    })

    it('accepts a name of 128 code points counted as code points', () => {
      const json = JSON.stringify({ v: 1, name: '\u{1F31F}'.repeat(128) })
      expect(open(owner, jsonPayload(owner, json))).toEqual({ ok: true, json })
    })

    it('accepts https and ipfs images and every optional key', () => {
      const json = JSON.stringify({
        v: 1,
        name: 'n',
        image: 'https://example.com:8080/a.png?x=1#y',
        description: 'd',
        ext: { 'attributes.v1': [] },
      })
      expect(open(owner, jsonPayload(owner, json))).toEqual({ ok: true, json })
      expect(open(owner, jsonPayload(owner, '{"v":1,"image":"ipfs://QmAbc/x.png"}'))).toMatchObject(
        {
          ok: true,
        }
      )
    })
  })
})

describe('sealParamsProblem', () => {
  const item = { payload: 'AAAA' }

  it('accepts 1 to 50 items', () => {
    expect(sealParamsProblem([item])).toBeNull()
    expect(sealParamsProblem(Array(MAX_SEALED_OPEN_BATCH).fill(item))).toBeNull()
  })

  it('refuses the wrong batch size and shapes', () => {
    for (const params of [
      undefined,
      [],
      'x',
      {},
      Array(MAX_SEALED_OPEN_BATCH + 1).fill(item),
      [null],
      ['AAAA'],
      [{}],
      [{ payload: 5 }],
      [{ payload: 'A'.repeat(21849) }],
    ]) {
      expect(sealParamsProblem(params)).toEqual(expect.any(String))
    }
  })
})

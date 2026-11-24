import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'
import { Address } from 'znn-typescript-sdk'

import { sealMessage, type MessageToOpen } from '@/core/message-envelope'
import { sodiumSealPayload } from '@/test/sealed'
import { installFakeChrome } from '@/test/fake-chrome'
import { OTHER_ENTROPY, TEST_ENTROPY, testAccount, walletStorage } from '@/test/message-account'

const ORIGIN = 'https://dapp.example'
const WALLETS_KEY = 'nom-wallet-storage'
const ACTIVITY_KEY = 'nom-wallet.lastActivityAt'
const AUTO_LOCK_KEY = 'nom-wallet-auto-lock-minutes'
const START = new Date('2026-01-01T00:00:00.000Z').getTime()
const MINUTE = 60_000

let env: ReturnType<typeof installFakeChrome>
let decrypt: typeof import('@/sw/message-decrypt')
let permissions: typeof import('@/core/site-permissions')

const base = () => testAccount(TEST_ENTROPY, 0)
const peer = () => testAccount(OTHER_ENTROPY, 0)
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

function seal(
  from: ReturnType<typeof testAccount>,
  to: ReturnType<typeof testAccount>,
  body = 'hello'
): string {
  const envelope = sealMessage({
    ownSeed: from.seed,
    ownPublicKey: from.publicKey,
    counterpartyPublicKey: to.publicKey,
    content: { body, replyTo: null },
  })
  return Buffer.from(envelope).toString('base64')
}

function item(data: string, counterparty: Uint8Array, outgoing: boolean): MessageToOpen {
  return { data, publicKey: hex(counterparty), outgoing }
}

/** An unlocked, granted wallet whose active account is index 0. */
async function unlock(options: { activityAgo?: number; entropy?: string } = {}) {
  env.local.data[WALLETS_KEY] = walletStorage(TEST_ENTROPY, [0, 1], 0)
  env.session.data['nom-wallet.key:' + base().address] = options.entropy ?? TEST_ENTROPY
  env.session.data[ACTIVITY_KEY] = Date.now() - (options.activityAgo ?? 0)
  await permissions.grant(ORIGIN)
  await permissions.grantMessages(ORIGIN, base().address)
}

beforeEach(async () => {
  // Only Date is faked: the fake storage yields through real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.resetModules()
  env = installFakeChrome()
  decrypt = await import('@/sw/message-decrypt')
  permissions = await import('@/core/site-permissions')
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('account key derivation', () => {
  const MNEMONIC_ENTROPY = ['00'.repeat(16), '7f'.repeat(16), TEST_ENTROPY]

  it.each([0, 1, 7])('equals the SDK for account index %i', (index) => {
    for (const entropy of MNEMONIC_ENTROPY) {
      const pair = KeyStore.fromEntropy(entropy).getKeyPair(index)
      const seed = decrypt.deriveAccountSeed(entropy, index)

      expect(hex(seed)).toBe(Buffer.from(pair.privateKey).toString('hex'))
      const publicKey = testAccount(entropy, index).publicKey
      expect(decrypt.addressOfPublicKey(publicKey)).toBe(
        Address.fromPublicKey(Buffer.from(publicKey)).toString()
      )
    }
  })
})

describe('decryptForOrigin', () => {
  it('opens messages sent to and from the active account', async () => {
    await unlock()
    const sent = item(seal(base(), peer(), 'from me'), peer().publicKey, true)
    const received = item(seal(peer(), base(), 'to me'), peer().publicKey, false)

    const outcome = await decrypt.decryptForOrigin(ORIGIN, [sent, received])

    expect(outcome).toEqual({
      result: [
        { ok: true, body: 'from me', replyTo: null },
        { ok: true, body: 'to me', replyTo: null },
      ],
    })
  })

  it('uses the key of the active account index', async () => {
    await unlock()
    const second = testAccount(TEST_ENTROPY, 1)
    env.local.data[WALLETS_KEY] = walletStorage(TEST_ENTROPY, [0, 1], 1)
    await permissions.grantMessages(ORIGIN, second.address)

    const outcome = await decrypt.decryptForOrigin(ORIGIN, [
      item(seal(peer(), second), peer().publicKey, false),
    ])

    expect(outcome).toEqual({ result: [expect.objectContaining({ ok: true, body: 'hello' })] })
  })

  it('answers per item when an item is not a readable message', async () => {
    await unlock()
    const outcome = await decrypt.decryptForOrigin(ORIGIN, [
      item('AAAA', peer().publicKey, false),
      item('not base64!', peer().publicKey, false),
      item(seal(peer(), base()), base().publicKey, false),
    ])

    expect(outcome).toEqual({
      result: [
        { ok: false, reason: 'notMessage' },
        { ok: false, reason: 'notMessage' },
        { ok: false, reason: 'unreadable' },
      ],
    })
  })

  describe('grant', () => {
    it('refuses 4100 without a message grant', async () => {
      await unlock()
      await permissions.revokeMessages(ORIGIN)

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toEqual({
        error: { code: 4100, message: 'Message access is not granted for this account.' },
      })
    })

    it('refuses 4100 for an origin with no entry', async () => {
      await unlock()

      expect(await decrypt.decryptForOrigin('https://other.example', [])).toMatchObject({
        error: { code: 4100 },
      })
    })

    it('refuses 4100 when only another account has the grant', async () => {
      await unlock()
      await permissions.revokeMessages(ORIGIN)
      await permissions.grantMessages(ORIGIN, testAccount(TEST_ENTROPY, 1).address)

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4100 } })
    })

    it('checks the grant on every call', async () => {
      await unlock()
      const items = [item(seal(peer(), base()), peer().publicKey, false)]

      expect(await decrypt.decryptForOrigin(ORIGIN, items)).toHaveProperty('result')
      await permissions.revokeMessages(ORIGIN)
      expect(await decrypt.decryptForOrigin(ORIGIN, items)).toMatchObject({ error: { code: 4100 } })
      await permissions.grantMessages(ORIGIN, base().address)
      expect(await decrypt.decryptForOrigin(ORIGIN, items)).toHaveProperty('result')
      await permissions.revoke(ORIGIN)
      expect(await decrypt.decryptForOrigin(ORIGIN, items)).toMatchObject({ error: { code: 4100 } })
    })

    it('checks the grant before it reads the key cache', async () => {
      await unlock()
      await permissions.revokeMessages(ORIGIN)
      const getSession = vi.spyOn(env.session, 'get')

      await decrypt.decryptForOrigin(ORIGIN, [])

      expect(getSession).not.toHaveBeenCalled()
    })
  })

  describe('lock state', () => {
    it('refuses 4900 with no key entry', async () => {
      await unlock()
      delete env.session.data['nom-wallet.key:' + base().address]

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toEqual({
        error: { code: 4900, message: 'Wallet is locked.' },
      })
    })

    it('refuses 4900 with no activity time', async () => {
      await unlock()
      delete env.session.data[ACTIVITY_KEY]

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })

    it('refuses 4900 when only another wallet is unlocked', async () => {
      await unlock()
      delete env.session.data['nom-wallet.key:' + base().address]
      env.session.data['nom-wallet.key:' + peer().address] = OTHER_ENTROPY

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })

    it('refuses 4900 when the cached key does not yield the active account', async () => {
      await unlock({ entropy: OTHER_ENTROPY })

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })

    it('refuses 4900 with no wallet', async () => {
      await unlock()
      delete env.local.data[WALLETS_KEY]

      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })
  })

  describe('auto-lock time', () => {
    it('refuses past the default 30 minutes and answers inside it', async () => {
      await unlock({ activityAgo: 29 * MINUTE })
      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toHaveProperty('result')

      env.session.data[ACTIVITY_KEY] = Date.now() - 31 * MINUTE
      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })

    it.each([5, 15, 60])('honours a setting of %i minutes', async (minutes) => {
      env.local.data[AUTO_LOCK_KEY] = minutes
      await unlock({ activityAgo: (minutes - 1) * MINUTE })
      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toHaveProperty('result')

      env.session.data[ACTIVITY_KEY] = Date.now() - (minutes + 1) * MINUTE
      expect(await decrypt.decryptForOrigin(ORIGIN, [])).toMatchObject({ error: { code: 4900 } })
    })

    it('does not extend the auto-lock time, and writes nothing', async () => {
      await unlock({ activityAgo: 10 * MINUTE })
      const items = [item(seal(peer(), base()), peer().publicKey, false)]
      const sessionBefore = structuredClone(env.session.data)
      const localBefore = structuredClone(env.local.data)
      const sessionSet = vi.spyOn(env.session, 'set')
      const sessionRemove = vi.spyOn(env.session, 'remove')
      const localSet = vi.spyOn(env.local, 'set')

      for (let i = 0; i < 3; i++) await decrypt.decryptForOrigin(ORIGIN, items)

      expect(env.session.data).toEqual(sessionBefore)
      expect(env.local.data).toEqual(localBefore)
      expect(sessionSet).not.toHaveBeenCalled()
      expect(sessionRemove).not.toHaveBeenCalled()
      expect(localSet).not.toHaveBeenCalled()
      expect(env.chrome.alarms.create).not.toHaveBeenCalled()

      // The unchanged activity time still runs out on schedule.
      vi.setSystemTime(START + 21 * MINUTE)
      expect(await decrypt.decryptForOrigin(ORIGIN, items)).toMatchObject({ error: { code: 4900 } })
    })
  })

  describe('key material', () => {
    it('never puts key material in a result, an error or a log', async () => {
      await unlock()
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {})
      )
      const secrets = [
        hex(base().seed),
        hex(peer().seed),
        TEST_ENTROPY,
        Buffer.from(base().seed).toString('base64'),
      ]
      const outcomes = [
        await decrypt.decryptForOrigin(ORIGIN, [
          item(seal(peer(), base()), peer().publicKey, false),
          item('AAAA', peer().publicKey, false),
        ]),
      ]
      delete env.session.data['nom-wallet.key:' + base().address]
      outcomes.push(await decrypt.decryptForOrigin(ORIGIN, []))
      await permissions.revokeMessages(ORIGIN)
      outcomes.push(await decrypt.decryptForOrigin(ORIGIN, []))

      const serialised = JSON.stringify(outcomes)
      for (const secret of secrets) expect(serialised).not.toContain(secret)
      for (const log of logs) expect(log).not.toHaveBeenCalled()
    })

    it('zeroes the derived seed and the entropy bytes after use', async () => {
      const seen: Uint8Array[] = []
      const entropies: Uint8Array[] = []
      vi.resetModules()
      vi.doMock('@scure/bip39', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@scure/bip39')>()
        return {
          ...actual,
          entropyToMnemonic: (entropy: Uint8Array, wordlist: string[]) => {
            entropies.push(entropy)
            return actual.entropyToMnemonic(entropy, wordlist)
          },
        }
      })
      vi.doMock('@noble/curves/ed25519', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@noble/curves/ed25519')>()
        const getPublicKey = actual.ed25519.getPublicKey.bind(actual.ed25519)
        actual.ed25519.getPublicKey = (seed) => {
          seen.push(seed as Uint8Array)
          return getPublicKey(seed)
        }
        return actual
      })
      decrypt = await import('@/sw/message-decrypt')
      permissions = await import('@/core/site-permissions')
      await unlock()
      const items = [item(seal(peer(), base()), peer().publicKey, false)]
      seen.length = 0
      entropies.length = 0

      await decrypt.decryptForOrigin(ORIGIN, items)

      expect(seen.length).toBeGreaterThan(0)
      for (const seed of seen) expect(seed.every((byte) => byte === 0)).toBe(true)
      expect(entropies).toHaveLength(1)
      expect(entropies[0].every((byte) => byte === 0)).toBe(true)
      vi.doUnmock('@noble/curves/ed25519')
      vi.doUnmock('@scure/bip39')
    })
  })
})

describe('decryptInscriptionsForOrigin', () => {
  const NAMED = JSON.stringify({ v: 1, name: 'Sealed' })

  const payloadFor = (to: ReturnType<typeof testAccount>, json = NAMED) =>
    sodiumSealPayload(json, to.publicKey)

  it('opens payloads sealed to the active account, in input order', async () => {
    await unlock()
    const mine = await payloadFor(base())
    const theirs = await payloadFor(peer())

    const outcome = await decrypt.decryptInscriptionsForOrigin(ORIGIN, [
      { payload: mine },
      { payload: theirs },
      { payload: 'AAAA' },
    ])

    expect(outcome).toEqual({
      result: [
        { ok: true, json: NAMED },
        { ok: false, reason: 'unreadable' },
        { ok: false, reason: 'unreadable' },
      ],
    })
  })

  it('uses the key of the active account index', async () => {
    await unlock()
    const second = testAccount(TEST_ENTROPY, 1)
    env.local.data[WALLETS_KEY] = walletStorage(TEST_ENTROPY, [0, 1], 1)
    await permissions.grantMessages(ORIGIN, second.address)

    expect(
      await decrypt.decryptInscriptionsForOrigin(ORIGIN, [{ payload: await payloadFor(second) }])
    ).toEqual({ result: [{ ok: true, json: NAMED }] })
  })

  describe('gate shared with decryptForOrigin', () => {
    const paths = [
      ['decryptForOrigin', (origin: string) => decrypt.decryptForOrigin(origin, [])],
      [
        'decryptInscriptionsForOrigin',
        (origin: string) => decrypt.decryptInscriptionsForOrigin(origin, []),
      ],
    ] as const

    it.each(paths)(
      '%s refuses 4100 without a grant, for another account and on revoke',
      async (_name, run) => {
        await unlock()
        expect(await run(ORIGIN)).toHaveProperty('result')
        expect(await run('https://other.example')).toMatchObject({ error: { code: 4100 } })
        await permissions.revokeMessages(ORIGIN)
        expect(await run(ORIGIN)).toMatchObject({ error: { code: 4100 } })
        await permissions.grantMessages(ORIGIN, testAccount(TEST_ENTROPY, 1).address)
        expect(await run(ORIGIN)).toMatchObject({ error: { code: 4100 } })
      }
    )

    it.each(paths)('%s checks the grant before it reads the key cache', async (_name, run) => {
      await unlock()
      await permissions.revokeMessages(ORIGIN)
      const getSession = vi.spyOn(env.session, 'get')

      await run(ORIGIN)

      expect(getSession).not.toHaveBeenCalled()
    })

    it.each(paths)(
      '%s refuses 4900 when locked, mismatched or without a wallet',
      async (_name, run) => {
        await unlock()
        delete env.session.data['nom-wallet.key:' + base().address]
        expect(await run(ORIGIN)).toEqual({ error: { code: 4900, message: 'Wallet is locked.' } })

        env.session.data['nom-wallet.key:' + base().address] = OTHER_ENTROPY
        expect(await run(ORIGIN)).toMatchObject({ error: { code: 4900 } })

        delete env.local.data[WALLETS_KEY]
        expect(await run(ORIGIN)).toMatchObject({ error: { code: 4900 } })
      }
    )

    it.each(paths)(
      '%s refuses 4900 past the auto-lock time and writes nothing',
      async (_name, run) => {
        await unlock({ activityAgo: 10 * MINUTE })
        const sessionBefore = structuredClone(env.session.data)
        const localBefore = structuredClone(env.local.data)
        const sets = [
          vi.spyOn(env.session, 'set'),
          vi.spyOn(env.session, 'remove'),
          vi.spyOn(env.local, 'set'),
        ]

        for (let i = 0; i < 3; i++) expect(await run(ORIGIN)).toHaveProperty('result')

        expect(env.session.data).toEqual(sessionBefore)
        expect(env.local.data).toEqual(localBefore)
        for (const spy of sets) expect(spy).not.toHaveBeenCalled()
        expect(env.chrome.alarms.create).not.toHaveBeenCalled()
        vi.setSystemTime(START + 21 * MINUTE)
        expect(await run(ORIGIN)).toMatchObject({ error: { code: 4900 } })
      }
    )
  })

  describe('key material', () => {
    it('never puts key material in a result, an error or a log', async () => {
      await unlock()
      const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {})
      )
      const secrets = [hex(base().seed), TEST_ENTROPY, Buffer.from(base().seed).toString('base64')]
      const outcomes = [
        await decrypt.decryptInscriptionsForOrigin(ORIGIN, [
          { payload: await payloadFor(base()) },
          { payload: 'AAAA' },
        ]),
      ]
      delete env.session.data['nom-wallet.key:' + base().address]
      outcomes.push(await decrypt.decryptInscriptionsForOrigin(ORIGIN, []))

      const serialised = JSON.stringify(outcomes)
      for (const secret of secrets) expect(serialised).not.toContain(secret)
      for (const log of logs) expect(log).not.toHaveBeenCalled()
    })

    it('zeroes the seed, the entropy and the box key bytes after use', async () => {
      const seen: Uint8Array[] = []
      const entropies: Uint8Array[] = []
      const digests: Uint8Array[] = []
      vi.resetModules()
      vi.doMock('@scure/bip39', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@scure/bip39')>()
        return {
          ...actual,
          entropyToMnemonic: (entropy: Uint8Array, wordlist: string[]) => {
            entropies.push(entropy)
            return actual.entropyToMnemonic(entropy, wordlist)
          },
        }
      })
      vi.doMock('@noble/curves/ed25519', async (importOriginal) => {
        const actual = await importOriginal<typeof import('@noble/curves/ed25519')>()
        const getPublicKey = actual.ed25519.getPublicKey.bind(actual.ed25519)
        actual.ed25519.getPublicKey = (seed) => {
          seen.push(seed as Uint8Array)
          return getPublicKey(seed)
        }
        const shared = actual.x25519.getSharedSecret.bind(actual.x25519)
        actual.x25519.getSharedSecret = (secret, publicKey) => {
          digests.push(secret as Uint8Array)
          const out = shared(secret, publicKey)
          digests.push(out)
          return out
        }
        return actual
      })
      decrypt = await import('@/sw/message-decrypt')
      permissions = await import('@/core/site-permissions')
      await unlock()
      const items = [{ payload: await payloadFor(base()) }]
      seen.length = 0
      entropies.length = 0
      digests.length = 0

      const outcome = await decrypt.decryptInscriptionsForOrigin(ORIGIN, items)

      expect(outcome).toEqual({ result: [{ ok: true, json: NAMED }] })
      expect(seen.length).toBeGreaterThan(0)
      for (const seed of seen) expect(seed.every((byte) => byte === 0)).toBe(true)
      expect(entropies).toHaveLength(1)
      expect(entropies[0].every((byte) => byte === 0)).toBe(true)
      // The X25519 secret is a view of the SHA-512 digest, and the shared secret.
      expect(digests).toHaveLength(2)
      for (const bytes of digests) expect(bytes.every((byte) => byte === 0)).toBe(true)
      vi.doUnmock('@noble/curves/ed25519')
      vi.doUnmock('@scure/bip39')
    })
  })
})

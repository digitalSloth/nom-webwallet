import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeChrome } from '@/test/fake-chrome'

type Permissions = typeof import('@/core/site-permissions')

const ORIGIN = 'https://dapp.example'
const PERMISSIONS_KEY = 'nom-wallet-site-permissions'
const START = new Date('2026-01-01T00:00:00.000Z').getTime()

let env: ReturnType<typeof installFakeChrome>
let permissions: Permissions

beforeEach(async () => {
  // Only Date is faked: the fake storage yields through real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.resetModules()
  env = installFakeChrome()
  permissions = await import('@/core/site-permissions')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function lastUsedAt(): number | undefined {
  const map = env.local.data[PERMISSIONS_KEY] as Record<string, { lastUsedAt: number }>
  return map[ORIGIN]?.lastUsedAt
}

describe('site permissions', () => {
  it('a touch racing a revoke never brings the origin back', async () => {
    await permissions.grant(ORIGIN)
    vi.setSystemTime(START + 5 * 60 * 1000)

    await Promise.all([permissions.revoke(ORIGIN), permissions.touch(ORIGIN)])

    expect(await permissions.isGranted(ORIGIN)).toBe(false)
  })

  it('a touch racing revoke-all never brings the origin back', async () => {
    await permissions.grant(ORIGIN)
    vi.setSystemTime(START + 5 * 60 * 1000)

    await Promise.all([permissions.revokeAll(), permissions.touch(ORIGIN)])

    expect(await permissions.list()).toEqual([])
  })

  it('writes lastUsedAt at most once a minute', async () => {
    await permissions.grant(ORIGIN)

    vi.setSystemTime(START + 30 * 1000)
    await permissions.touch(ORIGIN)
    expect(lastUsedAt()).toBe(START)

    vi.setSystemTime(START + 61 * 1000)
    await permissions.touch(ORIGIN)
    expect(lastUsedAt()).toBe(START + 61 * 1000)
  })

  it('does not grant an origin by touching it', async () => {
    await permissions.touch(ORIGIN)

    expect(await permissions.isGranted(ORIGIN)).toBe(false)
  })

  describe('isSecureMessageOrigin', () => {
    it.each([
      'https://zenonhub.io',
      'https://localhost',
      'http://localhost',
      'http://localhost:5173',
      'http://127.0.0.1:8000',
      'http://[::1]:8000',
      'http://zenonhub.localhost',
      'http://devnet.zenonhub.localhost',
    ])('accepts %s', (origin) => {
      expect(permissions.isSecureMessageOrigin(origin)).toBe(true)
    })

    it.each([
      'http://example.com',
      'http://192.168.1.5',
      'http://localhost.evil.com',
      'http://evil-localhost',
      'http://evillocalhost',
      'ftp://localhost',
      'chrome-extension://abc',
      'null',
      '',
    ])('refuses %s', (origin) => {
      expect(permissions.isSecureMessageOrigin(origin)).toBe(false)
    })
  })

  describe('message access', () => {
    const ACCOUNT = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'
    const OTHER = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

    it('grantMessages on an unknown origin is a no-op', async () => {
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      expect(await permissions.list()).toEqual([])
      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(false)
    })

    it('grants one account and lists several', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)
      await permissions.grantMessages(ORIGIN, ACCOUNT)
      await permissions.grantMessages(ORIGIN, OTHER)

      expect((await permissions.list())[0].messageAccounts).toEqual([ACCOUNT, OTHER])
      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(true)
      expect(await permissions.canReadMessages('https://other.example', ACCOUNT)).toBe(false)
    })

    it('grant() keeps messageAccounts when it rebuilds the entry', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      await permissions.grant(ORIGIN, { title: 'Dapp' })

      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(true)
    })

    it('a touch keeps messageAccounts', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)
      vi.setSystemTime(START + 5 * 60 * 1000)

      await permissions.touch(ORIGIN)

      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(true)
    })

    it('revoke removes the origin and its messageAccounts', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      await permissions.revoke(ORIGIN)
      await permissions.grant(ORIGIN)

      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(false)
    })

    it('revokeAll removes every messageAccounts', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      await permissions.revokeAll()
      await permissions.grant(ORIGIN)

      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(false)
    })

    it('revokeMessages keeps the site connected', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      await permissions.revokeMessages(ORIGIN)

      expect(await permissions.isGranted(ORIGIN)).toBe(true)
      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(false)
      expect((await permissions.list())[0]).not.toHaveProperty('messageAccounts')
    })

    it('a revokeMessages racing a grantMessages leaves one consistent result', async () => {
      await permissions.grant(ORIGIN)
      await permissions.grantMessages(ORIGIN, ACCOUNT)

      await Promise.all([
        permissions.revokeMessages(ORIGIN),
        permissions.grantMessages(ORIGIN, OTHER),
      ])

      expect(await permissions.canReadMessages(ORIGIN, ACCOUNT)).toBe(false)
      expect(await permissions.canReadMessages(ORIGIN, OTHER)).toBe(true)
    })
  })
})

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
})

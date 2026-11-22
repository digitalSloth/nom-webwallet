import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_AUTO_LOCK_MINUTES } from '@/config'
import { installFakeChrome } from '@/test/fake-chrome'

let env: ReturnType<typeof installFakeChrome>
let policy: typeof import('@/core/auto-lock-policy')

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
  policy = await import('@/core/auto-lock-policy')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseAutoLockMinutes', () => {
  it.each([5, 15, 30, 60])('keeps the choice %i', (minutes) => {
    expect(policy.parseAutoLockMinutes(minutes)).toBe(minutes)
  })

  it.each(['5', 7, 0, NaN, null, undefined])('maps %j to 30', (value) => {
    expect(policy.parseAutoLockMinutes(value)).toBe(30)
  })
})

describe('readAutoLockMinutes', () => {
  it('returns the stored choice', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 5
    expect(await policy.readAutoLockMinutes()).toBe(5)
  })

  it('returns 30 when nothing is stored', async () => {
    expect(await policy.readAutoLockMinutes()).toBe(30)
  })

  it('returns 30 when the stored value is invalid', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 7
    expect(await policy.readAutoLockMinutes()).toBe(30)
  })

  it('returns 30 and logs when the read rejects', async () => {
    vi.spyOn(env.local, 'get').mockRejectedValueOnce(new Error('boom'))

    expect(await policy.readAutoLockMinutes()).toBe(30)
    expect(console.error).toHaveBeenCalled()
  })
})

describe('autoLockMs', () => {
  it('is 30 minutes by default and follows setAutoLockMinutes', () => {
    expect(policy.autoLockMs()).toBe(1_800_000)

    policy.setAutoLockMinutes(5)

    expect(policy.autoLockMs()).toBe(300_000)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AUTO_LOCK_ALARM,
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_PREFIX_UNLOCKED,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
} from '@/config'
import { installFakeChrome } from '@/test/fake-chrome'

const THIRTY_MINUTES = 30 * 60_000
const KEY = SESSION_KEY_PREFIX_UNLOCKED + 'z1address'

let env: ReturnType<typeof installFakeChrome>
let autoLock: typeof import('@/sw/auto-lock')

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
  autoLock = await import('@/sw/auto-lock')
  env.session.data[KEY] = 'entropy'
  env.session.data.other = 'keep'
})

describe('handleAutoLockAlarm', () => {
  it('registers the alarm listener on import', () => {
    expect(env.chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1)
  })

  it('wipes key entries and clears the alarm when activity expired', async () => {
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now() - THIRTY_MINUTES - 1

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(KEY in env.session.data).toBe(false)
    expect(env.session.data.other).toBe('keep')
    expect(env.chrome.alarms.clear).toHaveBeenCalledWith(AUTO_LOCK_ALARM)
  })

  it('clears the alarm before it reads the key entries', async () => {
    const order: string[] = []
    env.chrome.alarms.clear.mockImplementation(async () => {
      order.push('clear')
      return true
    })
    const get = env.session.get.bind(env.session)
    vi.spyOn(env.session, 'get').mockImplementation(async (keys) => {
      order.push('get')
      return get(keys)
    })

    await autoLock.wipeKeyCache()

    expect(order.slice(0, 2)).toEqual(['clear', 'get'])
  })

  it('wipes key entries when lastActivityAt is missing', async () => {
    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(KEY in env.session.data).toBe(false)
  })

  it('re-arms the alarm for the new deadline when activity is fresh', async () => {
    const lastActivityAt = Date.now() - 60_000
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = lastActivityAt

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: lastActivityAt + THIRTY_MINUTES + 1,
    })
    expect(KEY in env.session.data).toBe(true)
  })

  it('keeps a session unlocked after the expiry check but before the wipe reads storage', async () => {
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now() - THIRTY_MINUTES - 1
    const fresh = SESSION_KEY_PREFIX_UNLOCKED + 'z1fresh'
    env.chrome.alarms.clear.mockImplementationOnce(async () => {
      env.session.data[fresh] = 'fresh-entropy'
      env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now()
      return true
    })

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(fresh in env.session.data).toBe(true)
    expect(KEY in env.session.data).toBe(false)
  })

  it('re-arms the alarm for a key unlocked after the read and before the clear', async () => {
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now() - THIRTY_MINUTES - 1
    const fresh = SESSION_KEY_PREFIX_UNLOCKED + 'z1fresh'
    const unlockedAt = Date.now()
    env.chrome.alarms.clear.mockImplementationOnce(async () => {
      env.session.data[fresh] = 'fresh-entropy'
      env.session.data[SESSION_KEY_LAST_ACTIVITY] = unlockedAt
      return true
    })

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(fresh in env.session.data).toBe(true)
    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: unlockedAt + THIRTY_MINUTES + 1,
    })
  })

  it('leaves the alarm cleared when no key remains', async () => {
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now() - THIRTY_MINUTES - 1

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(env.chrome.alarms.create).not.toHaveBeenCalled()
  })

  it('ignores other alarms', async () => {
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = 0

    await autoLock.handleAutoLockAlarm({ name: 'something-else' })

    expect(KEY in env.session.data).toBe(true)
    expect(env.chrome.alarms.clear).not.toHaveBeenCalled()
  })

  it('logs and does not throw when storage fails', async () => {
    vi.spyOn(env.session, 'get').mockRejectedValueOnce(new Error('boom'))

    await expect(autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })).resolves.toBeUndefined()
  })
})

describe('lockIfNoWindows', () => {
  it('wipes every key entry and clears the alarm when no window is open', async () => {
    env.chrome.windows.getAll.mockResolvedValueOnce([])

    await autoLock.lockIfNoWindows()

    expect(KEY in env.session.data).toBe(false)
    expect(env.session.data.other).toBe('keep')
    expect(env.chrome.alarms.clear).toHaveBeenCalledWith(AUTO_LOCK_ALARM)
  })

  it('removes nothing while a window is open', async () => {
    env.chrome.windows.getAll.mockResolvedValueOnce([{ id: 1 }] as never[])

    await autoLock.lockIfNoWindows()

    expect(KEY in env.session.data).toBe(true)
  })
})

describe('auto-lock setting', () => {
  const MINUTE = 60_000

  it('wipes when activity is older than the stored 5 minutes', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 5
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = Date.now() - 5 * MINUTE - 1

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(KEY in env.session.data).toBe(false)
  })

  it('re-arms at lastActivityAt + 5 minutes + 1 when 1 minute old', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 5
    const lastActivityAt = Date.now() - MINUTE
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = lastActivityAt

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(KEY in env.session.data).toBe(true)
    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: lastActivityAt + 5 * MINUTE + 1,
    })
  })

  it('applies 30 minutes when the stored value is invalid', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 7
    const lastActivityAt = Date.now() - MINUTE
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = lastActivityAt

    await autoLock.handleAutoLockAlarm({ name: AUTO_LOCK_ALARM })

    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: lastActivityAt + THIRTY_MINUTES + 1,
    })
  })

  it('re-arms a surviving key at the stored minutes after a wipe', async () => {
    env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = 60
    const lastActivityAt = Date.now()
    env.session.data[SESSION_KEY_LAST_ACTIVITY] = lastActivityAt
    const survivor = SESSION_KEY_PREFIX_UNLOCKED + 'z1survivor'
    env.session.data[survivor] = 'entropy'

    await autoLock.wipeKeyCache([KEY])

    expect(KEY in env.session.data).toBe(false)
    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: lastActivityAt + 60 * MINUTE + 1,
    })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'

import {
  AUTO_LOCK_ALARM,
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_PREFIX_UNLOCKED,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
} from '@/config'
import { autoLockMs, isActivityExpired } from '@/core/auto-lock-policy'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'

const START_TIME = new Date('2026-01-01T00:00:00.000Z')
const THIRTY_MINUTES = 30 * 60_000

const storeA = KeyStore.fromMnemonic('abandon '.repeat(23) + 'art')
const storeB = KeyStore.fromMnemonic('zoo '.repeat(23) + 'vote')
const addressA = storeA.getBaseAddress().toString()
const addressB = storeB.getBaseAddress().toString()
const keyA = SESSION_KEY_PREFIX_UNLOCKED + addressA
const keyB = SESSION_KEY_PREFIX_UNLOCKED + addressB

type Env = ReturnType<typeof installFakeChrome>
let env: Env
let cache: typeof import('@/core/key-cache')
let manager: typeof import('@/core/session-manager').sessionManager

async function load() {
  vi.resetModules()
  env = installFakeChrome({ emitChanges: true })
  vi.stubGlobal('window', new EventTarget())
  cache = await import('@/core/key-cache')
  manager = (await import('@/core/session-manager')).sessionManager
}

function seed(entries: Record<string, unknown>) {
  Object.assign(env.session.data, entries)
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await load()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isActivityExpired', () => {
  const limit = autoLockMs()
  const now = 1_000_000_000

  it('treats a missing timestamp as expired', () => {
    expect(isActivityExpired(undefined, now, limit)).toBe(true)
  })

  it('treats a future timestamp as expired', () => {
    expect(isActivityExpired(now + 1, now, limit)).toBe(true)
  })

  it('is not expired exactly at the deadline and expired after it', () => {
    expect(isActivityExpired(now - limit, now, limit)).toBe(false)
    expect(isActivityExpired(now - limit - 1, now, limit)).toBe(true)
  })
})

describe('key cache hydrate', () => {
  it('restores a fresh entry', async () => {
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() })

    await cache.startKeyCache()

    expect(manager.getKeyStore(addressA)?.getBaseAddress().toString()).toBe(addressA)
  })

  it('removes entries and restores nothing when activity expired', async () => {
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() - THIRTY_MINUTES - 1 })

    await cache.startKeyCache()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
  })

  it('removes entries that have no lastActivityAt', async () => {
    seed({ [keyA]: storeA.entropy })

    await cache.startKeyCache()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
  })

  it('removes entries when lastActivityAt is in the future', async () => {
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() + 60_000 })

    await cache.startKeyCache()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
  })

  it('removes an entry whose entropy does not match its address and keeps the valid one', async () => {
    seed({
      [keyA]: storeB.entropy,
      [keyB]: storeB.entropy,
      [SESSION_KEY_LAST_ACTIVITY]: Date.now(),
    })

    await cache.startKeyCache()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
    expect(manager.isUnlocked(addressB)).toBe(true)
  })

  it('restores nothing and writes no key when the access level cannot be restricted', async () => {
    env.session.setAccessLevel.mockRejectedValueOnce(new Error('denied'))
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() })

    await cache.startKeyCache()
    manager.unlock(addressB, storeB)
    await settleStorage()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyB in env.session.data).toBe(false)
  })

  it('drops a key removed by another document while hydrating', async () => {
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() })
    const realGet = env.session.get.bind(env.session)
    vi.spyOn(env.session, 'get').mockImplementationOnce(async (keys) => {
      const snapshot = await realGet(keys)
      const oldValue = env.session.data[keyA]
      delete env.session.data[keyA]
      env.emitStorageChange({ [keyA]: { oldValue } }, 'session')
      return snapshot
    })

    await cache.startKeyCache()

    expect(manager.isUnlocked(addressA)).toBe(false)
  })
})

describe('key cache writes', () => {
  beforeEach(async () => {
    await cache.startKeyCache()
  })

  it('writes the entry and lastActivityAt in one set call and arms the alarm', async () => {
    const set = vi.spyOn(env.session, 'set')

    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()

    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({
      [keyA]: storeA.entropy,
      [SESSION_KEY_LAST_ACTIVITY]: expect.any(Number),
    })
    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: expect.any(Number),
    })
  })

  it('lock removes only that key entry', async () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)
    seed({ unrelated: 'keep' })
    await cache.whenKeyCacheIdle()

    manager.lock(addressA)
    await cache.whenKeyCacheIdle()

    expect(keyA in env.session.data).toBe(false)
    expect(keyB in env.session.data).toBe(true)
    expect(env.session.data.unrelated).toBe('keep')
  })

  it('lockAll removes every key entry and keeps unrelated keys', async () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)
    seed({ unrelated: 'keep' })
    await cache.whenKeyCacheIdle()

    manager.lockAll()
    await cache.whenKeyCacheIdle()

    expect(
      Object.keys(env.session.data).filter((k) => k.startsWith(SESSION_KEY_PREFIX_UNLOCKED))
    ).toEqual([])
    expect(env.session.data.unrelated).toBe('keep')
    expect(env.chrome.alarms.clear).toHaveBeenCalledWith(AUTO_LOCK_ALARM)
  })

  it('issues the remove before lock returns even when the unlock write never settles', () => {
    vi.spyOn(env.session, 'set').mockImplementationOnce(() => new Promise(() => {}))
    manager.unlock(addressA, storeA)
    const remove = vi.spyOn(env.session, 'remove')

    manager.lock(addressA)

    expect(remove).toHaveBeenCalledWith(keyA)
  })

  it('whenKeyCacheIdle resolves only after the remove has applied', async () => {
    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()
    expect(keyA in env.session.data).toBe(true)

    manager.lock(addressA)
    await cache.whenKeyCacheIdle()

    expect(keyA in env.session.data).toBe(false)
  })

  it('lockAll sweeps an entry written by another document after start', async () => {
    seed({ [keyB]: storeB.entropy })

    manager.lockAll()
    await cache.whenKeyCacheIdle()

    expect(keyB in env.session.data).toBe(false)
  })
})

describe('key cache local timer', () => {
  it('leaves keys written by other documents alone when this document holds none', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
    seed({ [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() - THIRTY_MINUTES - 1 })
    const started = cache.startKeyCache()
    await vi.advanceTimersByTimeAsync(0)
    await started
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() })

    await vi.advanceTimersByTimeAsync(10)
    await cache.whenKeyCacheIdle()

    expect(keyA in env.session.data).toBe(true)
    expect(env.chrome.alarms.clear).not.toHaveBeenCalled()
  })
})

describe('key cache sync', () => {
  beforeEach(async () => {
    await cache.startKeyCache()
  })

  it('restores a session added elsewhere and calls the listener', () => {
    const seenUnlocked: boolean[] = []
    const listener = vi.fn(() => seenUnlocked.push(manager.isUnlocked(addressA)))
    cache.onKeyCacheChange(listener)

    env.emitStorageChange(
      {
        [keyA]: { newValue: storeA.entropy },
        [SESSION_KEY_LAST_ACTIVITY]: { newValue: Date.now() },
      },
      'session'
    )

    expect(manager.isUnlocked(addressA)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(seenUnlocked).toEqual([true])
  })

  it('drops a session removed elsewhere and calls the listener', () => {
    env.emitStorageChange({ [keyA]: { newValue: storeA.entropy } }, 'session')
    const listener = vi.fn()
    cache.onKeyCacheChange(listener)

    env.emitStorageChange({ [keyA]: { oldValue: storeA.entropy } }, 'session')

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not call the listener for a lastActivityAt-only change', () => {
    const listener = vi.fn()
    cache.onKeyCacheChange(listener)

    env.emitStorageChange({ [SESSION_KEY_LAST_ACTIVITY]: { newValue: Date.now() } }, 'session')

    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores changes in other storage areas', () => {
    env.emitStorageChange({ [keyA]: { newValue: storeA.entropy } }, 'local')

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    cache.onKeyCacheChange(listener)()

    env.emitStorageChange({ [keyA]: { newValue: storeA.entropy } }, 'session')

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('key cache activity', () => {
  it('writes lastActivityAt once within 15 s and again after', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START_TIME)
    await cache.startKeyCache()
    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()
    const set = vi.spyOn(env.session, 'set')

    vi.setSystemTime(START_TIME.getTime() + 14_000)
    cache.noteActivity()
    expect(set).not.toHaveBeenCalled()

    vi.setSystemTime(START_TIME.getTime() + 16_000)
    cache.noteActivity()
    cache.noteActivity()
    await cache.whenKeyCacheIdle()

    expect(set).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() + 16_000 })
  })

  it('ignores an untrusted input event', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START_TIME)
    await cache.startKeyCache()
    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()
    const set = vi.spyOn(env.session, 'set')
    env.chrome.alarms.create.mockClear()

    vi.setSystemTime(START_TIME.getTime() + 16_000)
    ;(window as unknown as EventTarget).dispatchEvent(new Event('keydown'))
    await cache.whenKeyCacheIdle()

    expect(set).not.toHaveBeenCalled()
    expect(env.chrome.alarms.create).not.toHaveBeenCalled()
  })

  it('counts a trusted input event as activity', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START_TIME)
    await cache.startKeyCache()
    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()
    const set = vi.spyOn(env.session, 'set')

    vi.setSystemTime(START_TIME.getTime() + 16_000)
    const event = new Event('keydown')
    Object.defineProperty(event, 'isTrusted', { value: true })
    ;(window as unknown as EventTarget).dispatchEvent(event)
    await cache.whenKeyCacheIdle()

    expect(set).toHaveBeenCalledWith({ [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() + 16_000 })
  })

  it('locks everything on activity after the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(START_TIME)
    await cache.startKeyCache()
    manager.unlock(addressA, storeA)
    await cache.whenKeyCacheIdle()
    const listener = vi.fn()
    cache.onKeyCacheChange(listener)

    vi.setSystemTime(START_TIME.getTime() + THIRTY_MINUTES + 1)
    cache.noteActivity()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
    expect(listener).toHaveBeenCalled()
  })

  it('does nothing when no wallet is unlocked', async () => {
    await cache.startKeyCache()
    const set = vi.spyOn(env.session, 'set')

    cache.noteActivity()

    expect(set).not.toHaveBeenCalled()
  })

  it('the local timer locks all after 30 minutes and 1 ms without activity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
    const started = cache.startKeyCache()
    await vi.advanceTimersByTimeAsync(10)
    await started
    const listener = vi.fn()
    cache.onKeyCacheChange(listener)
    manager.unlock(addressA, storeA)
    await vi.advanceTimersByTimeAsync(10)

    await vi.advanceTimersByTimeAsync(THIRTY_MINUTES - 10)
    expect(listener).not.toHaveBeenCalled()
    expect(keyA in env.session.data).toBe(true)

    await vi.advanceTimersByTimeAsync(11)
    await vi.advanceTimersByTimeAsync(100)
    expect(listener).toHaveBeenCalled()
    expect(keyA in env.session.data).toBe(false)
  })
})

const MINUTE = 60_000
const SETTING = STORAGE_KEY_AUTO_LOCK_MINUTES

describe('key cache auto-lock setting', () => {
  async function startAt(stored?: unknown, activityAge = 0) {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
    if (stored !== undefined) env.local.data[SETTING] = stored
    seed({
      [keyA]: storeA.entropy,
      [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() - activityAge,
    })
    const started = cache.startKeyCache()
    await vi.advanceTimersByTimeAsync(10)
    await started
  }

  it('removes the entry on hydrate when activity is older than the stored 5 minutes', async () => {
    env.local.data[SETTING] = 5
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() - 5 * MINUTE - 1 })

    await cache.startKeyCache()
    await cache.whenKeyCacheIdle()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(keyA in env.session.data).toBe(false)
  })

  it('restores on hydrate when activity is 4 minutes old and 5 is stored', async () => {
    env.local.data[SETTING] = 5
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() - 4 * MINUTE })

    await cache.startKeyCache()

    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('applies 30 minutes when the stored value is invalid', async () => {
    env.local.data[SETTING] = 7
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: Date.now() - 10 * MINUTE })

    await cache.startKeyCache()

    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('locks all at lastActivityAt + 5 minutes + 1 ms after a local change to 5 and re-creates the alarm', async () => {
    await startAt()
    expect(manager.isUnlocked(addressA)).toBe(true)
    env.chrome.alarms.create.mockClear()

    env.emitStorageChange({ [SETTING]: { newValue: 5 } }, 'local')

    expect(env.chrome.alarms.create).toHaveBeenCalledWith(AUTO_LOCK_ALARM, {
      when: START_TIME.getTime() + 5 * MINUTE + 1,
    })
    // startAt leaves the clock 10 ms past lastActivityAt
    await vi.advanceTimersByTimeAsync(5 * MINUTE - 10)
    expect(manager.isUnlocked(addressA)).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('measures from last activity, so lowering below the idle time locks at once', async () => {
    await startAt(undefined, 10 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)

    env.emitStorageChange({ [SETTING]: { newValue: 5 } }, 'local')
    await vi.advanceTimersByTimeAsync(1)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('does not extend lastActivityAt when the setting changes', async () => {
    await startAt(undefined, 10 * MINUTE)
    const before = env.session.data[SESSION_KEY_LAST_ACTIVITY]

    env.emitStorageChange({ [SETTING]: { newValue: 60 } }, 'local')
    await vi.advanceTimersByTimeAsync(10)

    expect(env.session.data[SESSION_KEY_LAST_ACTIVITY]).toBe(before)
  })

  it('stays unlocked for 6 minutes when changed from 5 to 60', async () => {
    await startAt(5)
    env.emitStorageChange({ [SETTING]: { newValue: 60 } }, 'local')

    await vi.advanceTimersByTimeAsync(6 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('prefers a local change that arrives while the hydrate read is pending', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
    env.local.data[SETTING] = 60
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const get = env.local.get.bind(env.local)
    vi.spyOn(env.local, 'get').mockImplementation(async (keys) => {
      await gate
      return get(keys)
    })
    seed({ [keyA]: storeA.entropy, [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() })
    const started = cache.startKeyCache()
    await vi.advanceTimersByTimeAsync(10)

    env.emitStorageChange({ [SETTING]: { newValue: 5 } }, 'local')
    release()
    await vi.advanceTimersByTimeAsync(10)
    await started
    await vi.advanceTimersByTimeAsync(5 * MINUTE + 1)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('reverts to 30 minutes when the setting is removed', async () => {
    await startAt(5)
    env.emitStorageChange({ [SETTING]: { oldValue: 5 } }, 'local')

    await vi.advanceTimersByTimeAsync(29 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    await vi.advanceTimersByTimeAsync(MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('re-creates no alarm in a document that holds no key', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(START_TIME)
    seed({ [SESSION_KEY_LAST_ACTIVITY]: START_TIME.getTime() })
    const started = cache.startKeyCache()
    await vi.advanceTimersByTimeAsync(10)
    await started
    env.chrome.alarms.create.mockClear()

    env.emitStorageChange({ [SETTING]: { newValue: 5 } }, 'local')

    expect(env.chrome.alarms.create).not.toHaveBeenCalled()
  })

  it('ignores other local keys', async () => {
    await startAt(5)
    env.chrome.alarms.create.mockClear()

    env.emitStorageChange({ somethingElse: { newValue: 60 } }, 'local')
    await vi.advanceTimersByTimeAsync(5 * MINUTE + 1)

    expect(env.chrome.alarms.create).not.toHaveBeenCalled()
    expect(manager.isUnlocked(addressA)).toBe(false)
  })
})

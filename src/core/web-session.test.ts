import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'

import {
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_LOCKED_AT,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
  STORAGE_KEY_WALLETS,
  WEB_SESSION_CHANNEL,
} from '@/config'
import { flushChannels, installFakeWeb, type FakeWeb } from '@/test/fake-web'

const T0 = new Date('2026-01-01T00:00:00.000Z').getTime()
const MINUTE = 60_000

const storeA = KeyStore.fromMnemonic('abandon '.repeat(23) + 'art')
const storeB = KeyStore.fromMnemonic('zoo '.repeat(23) + 'vote')
const addressA = storeA.getBaseAddress().toString()
const addressB = storeB.getBaseAddress().toString()

let web: FakeWeb
let ws: typeof import('./web-session')
let manager: typeof import('./session-manager').sessionManager
let policy: typeof import('./auto-lock-policy')
let otherTab: BroadcastChannel
let received: unknown[]

async function load(storedMinutes: string | null = '5') {
  vi.resetModules()
  vi.useFakeTimers({ now: T0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  web = installFakeWeb()
  if (storedMinutes !== null) web.localStorage.setItem(STORAGE_KEY_AUTO_LOCK_MINUTES, storedMinutes)
  ws = await import('./web-session')
  manager = (await import('./session-manager')).sessionManager
  policy = await import('./auto-lock-policy')
  received = []
}

async function start() {
  await ws.startWebSession()
  otherTab = new BroadcastChannel(WEB_SESSION_CHANNEL)
  otherTab.onmessage = (event) => received.push(event.data)
}

function at(offsetMs: number) {
  vi.setSystemTime(T0 + offsetMs)
}

function activity() {
  return web.localStorage.getItem(SESSION_KEY_LAST_ACTIVITY)
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('web session expiry', () => {
  beforeEach(async () => {
    await load()
    await start()
  })

  it('keeps a session through the stored minutes and locks 1 ms after', () => {
    manager.unlock(addressA, storeA)

    at(5 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('checks expiry on every key access', () => {
    manager.unlock(addressA, storeA)
    at(5 * MINUTE)
    expect(manager.getKeyStore(addressA)).toBe(storeA)

    at(5 * MINUTE + 1)

    expect(manager.getKeyStore(addressA)).toBeNull()
    expect(manager.getUnlockedAddresses()).toEqual([])
  })

  it('counts from activity another tab wrote', () => {
    manager.unlock(addressA, storeA)
    at(4 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 4 * MINUTE))

    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(9 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('counts from the unlock time when the stored activity is older', () => {
    manager.unlock(addressA, storeA)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 - 10 * MINUTE))

    at(5 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('locks at the next check when the stored activity is in the future', () => {
    manager.unlock(addressA, storeA)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + MINUTE))

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('counts from the unlock time when the stored activity is unreadable', () => {
    manager.unlock(addressA, storeA)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, 'abc')

    at(5 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('counts from the unlock time when getItem throws', () => {
    manager.unlock(addressA, storeA)
    vi.spyOn(web.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })

    at(5 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })
})

describe('web session cross-tab revival', () => {
  const HOUR = 60 * MINUTE

  beforeEach(async () => {
    await load()
    await start()
  })

  it('keeps an unchecked expired session locked when another tab writes fresh activity', () => {
    manager.unlock(addressA, storeA)
    at(8 * HOUR)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 8 * HOUR))

    expect(manager.getKeyStore(addressA)).toBeNull()
  })

  it('expires an unchecked session when this tab unlocks another wallet later', () => {
    manager.unlock(addressA, storeA)
    at(8 * HOUR)

    manager.unlock(addressB, storeB)

    expect(manager.getUnlockedAddresses()).toEqual([addressB])
    expect(manager.getKeyStore(addressA)).toBeNull()
  })

  it('expires an unchecked session when activity jumps past the deadline within the gap rule', () => {
    manager.unlock(addressA, storeA)
    at(2 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(4 * MINUTE)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 4 * MINUTE))
    at(4 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(true)

    // Unchecked from here on; the other tab's later write cannot extend it.
    at(8 * MINUTE)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 11 * MINUTE))
    at(11 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('keeps a session another tab keeps alive while this tab checks in time', () => {
    manager.unlock(addressA, storeA)
    for (let minute = 1; minute <= 20; minute++) {
      at(minute * MINUTE)
      web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + minute * MINUTE))
      expect(manager.isUnlocked(addressA)).toBe(true)
    }
  })

  it('expires a session that began before another tab locked everything', () => {
    manager.unlock(addressA, storeA)
    at(MINUTE)
    web.localStorage.setItem(SESSION_KEY_LOCKED_AT, String(T0 + MINUTE))
    at(MINUTE + 1)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('keeps a session unlocked after the other tab locked everything', () => {
    web.localStorage.setItem(SESSION_KEY_LOCKED_AT, String(T0))
    at(MINUTE)
    manager.unlock(addressA, storeA)
    at(2 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('records the lock time on lockAll', () => {
    manager.unlock(addressA, storeA)
    at(MINUTE)
    manager.lockAll()

    expect(web.localStorage.getItem(SESSION_KEY_LOCKED_AT)).toBe(String(T0 + MINUTE))
  })

  it('drops every key when the page enters the back/forward cache', () => {
    manager.unlock(addressA, storeA)

    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))

    expect(manager.getUnlockedAddresses()).toEqual([])
  })

  it('keeps the keys when the page unloads without being cached', () => {
    manager.unlock(addressA, storeA)

    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }))

    expect(manager.getUnlockedAddresses()).toEqual([addressA])
  })
})

describe('web session auto-lock raise', () => {
  beforeEach(async () => {
    await load('5')
    await start()
  })

  it('locks a session past its old deadline when another tab raises the minutes', () => {
    manager.unlock(addressA, storeA)
    at(6 * MINUTE)

    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '60')

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('locks a session past its old deadline when this tab raises the minutes', async () => {
    const { useAutoLock } = await import('./composables/useAutoLock')
    manager.unlock(addressA, storeA)
    at(6 * MINUTE)

    await useAutoLock().setMinutes(60)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('applies a raise to a live session only after a check passes under the old time', () => {
    manager.unlock(addressA, storeA)
    at(4 * MINUTE)
    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '60')

    expect(manager.isUnlocked(addressA)).toBe(true)

    at(44 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('still locks a session unchecked past the old time after a raise', () => {
    manager.unlock(addressA, storeA)
    at(4 * MINUTE)
    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '60')

    at(10 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('applies a lowered time at the next check', () => {
    manager.unlock(addressA, storeA)
    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '15')
    at(2 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)
    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '5')

    at(8 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })
})

describe('web session activity', () => {
  beforeEach(async () => {
    await load()
    await start()
  })

  it('writes the activity time on unlock', () => {
    at(1000)
    manager.unlock(addressA, storeA)

    expect(activity()).toBe(String(T0 + 1000))
  })

  it('swallows a throwing write on unlock', () => {
    vi.spyOn(web.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    expect(() => manager.unlock(addressA, storeA)).not.toThrow()
    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('writes at most once per 15 seconds', () => {
    manager.unlock(addressA, storeA)

    at(14_999)
    ws.noteActivity()
    expect(activity()).toBe(String(T0))

    at(15_000)
    ws.noteActivity()
    expect(activity()).toBe(String(T0 + 15_000))

    at(20_000)
    ws.noteActivity()
    expect(activity()).toBe(String(T0 + 15_000))
  })

  it('writes nothing when this tab holds no session', () => {
    at(60_000)
    ws.noteActivity()

    expect(activity()).toBeNull()
  })

  it('locks, broadcasts once and writes nothing for activity after the deadline', async () => {
    manager.unlock(addressA, storeA)
    at(5 * MINUTE + 1)

    ws.noteActivity()
    ws.noteActivity()
    await flushChannels()

    expect(activity()).toBe(String(T0))
    expect(manager.getUnlockedAddresses()).toEqual([])
    expect(received).toEqual([{ kind: 'lock', address: addressA }])
  })

  it('never revives an expired session with later activity', () => {
    manager.unlock(addressA, storeA)
    at(5 * MINUTE + 1)
    ws.noteActivity()

    at(5 * MINUTE + 2)
    ws.noteActivity()

    expect(manager.isUnlocked(addressA)).toBe(false)
    expect(activity()).toBe(String(T0))
  })
})

describe('web session lock channel', () => {
  beforeEach(async () => {
    await load()
    await start()
  })

  it('posts exactly one lock message for a single lock', async () => {
    manager.unlock(addressA, storeA)

    manager.lock(addressA)
    await flushChannels()

    expect(received).toEqual([{ kind: 'lock', address: addressA }])
  })

  it('posts exactly one all-wallets message for lockAll and locks this tab', async () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)

    manager.lockAll()
    await flushChannels()

    expect(manager.getUnlockedAddresses()).toEqual([])
    expect(received).toEqual([{ kind: 'lock', address: null }])
  })

  it('drops only the named wallet and notifies lock, without posting back', async () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)
    const changes: string[] = []
    ws.onWebSessionChange((change) => changes.push(change))

    otherTab.postMessage({ kind: 'lock', address: addressA })
    await flushChannels()

    expect(manager.getUnlockedAddresses()).toEqual([addressB])
    expect(changes).toEqual(['lock'])
    expect(received).toEqual([])
  })

  it('drops every session on an all-wallets message, without posting back', async () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)
    const changes: string[] = []
    ws.onWebSessionChange((change) => changes.push(change))

    otherTab.postMessage({ kind: 'lock', address: null })
    await flushChannels()

    expect(manager.getUnlockedAddresses()).toEqual([])
    expect(changes).toEqual(['lock'])
    expect(received).toEqual([])
  })

  const malformed: [string, unknown][] = [
    ['null', null],
    ['a string', 'lock'],
    ['an empty object', {}],
    ['an unlock kind', { kind: 'unlock', address: addressA }],
    ['a missing address', { kind: 'lock' }],
    ['a numeric address', { kind: 'lock', address: 5 }],
  ]

  it.each(malformed)('ignores %s', async (_name, message) => {
    manager.unlock(addressA, storeA)
    const changes: string[] = []
    ws.onWebSessionChange((change) => changes.push(change))

    otherTab.postMessage(message)
    await flushChannels()

    expect(manager.getUnlockedAddresses()).toEqual([addressA])
    expect(changes).toEqual([])
  })

  it('never unlocks or extends from a received message', async () => {
    const restore = vi.spyOn(manager, 'restore')
    const unlock = vi.spyOn(manager, 'unlock')
    const entropy = (storeA as unknown as { entropy: string }).entropy

    otherTab.postMessage({ kind: 'lock', address: addressA, entropy })
    otherTab.postMessage({ kind: 'unlock', address: addressA, entropy })
    for (const [, message] of malformed) otherTab.postMessage(message)
    await flushChannels()

    expect(manager.getUnlockedAddresses()).toEqual([])
    expect(manager.getKeyStore(addressA)).toBeNull()
    expect(restore).not.toHaveBeenCalled()
    expect(unlock).not.toHaveBeenCalled()
    expect(activity()).toBeNull()
  })

  it('does not extend an unlocked session when a message arrives', async () => {
    manager.unlock(addressA, storeA)
    at(4 * MINUTE)

    otherTab.postMessage({ kind: 'lock', address: addressB })
    await flushChannels()

    expect(activity()).toBe(String(T0))
    at(5 * MINUTE + 1)
    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('shares no key material through the channel or localStorage', async () => {
    manager.unlock(addressA, storeA)
    at(15_000)
    ws.noteActivity()
    manager.lock(addressA)
    manager.unlock(addressB, storeB)
    manager.lockAll()
    await flushChannels()

    expect(received).toEqual([
      { kind: 'lock', address: addressA },
      { kind: 'lock', address: null },
    ])
    const keys = Array.from({ length: web.localStorage.length }, (_, i) => web.localStorage.key(i))
    expect(keys).toEqual([
      STORAGE_KEY_AUTO_LOCK_MINUTES,
      SESSION_KEY_LAST_ACTIVITY,
      SESSION_KEY_LOCKED_AT,
    ])
    expect(activity()).toMatch(/^\d+$/)
  })

  it('runs without a channel when BroadcastChannel is unavailable', async () => {
    await load()
    vi.stubGlobal('BroadcastChannel', undefined)

    await expect(ws.startWebSession()).resolves.toBeUndefined()
    manager.unlock(addressA, storeA)

    expect(() => manager.lockAll()).not.toThrow()
    expect(manager.getUnlockedAddresses()).toEqual([])
  })
})

describe('web session start', () => {
  it('returns one promise, attaches one backend and opens one channel', async () => {
    await load()
    const Base = globalThis.BroadcastChannel
    const opened = vi.fn()
    vi.stubGlobal(
      'BroadcastChannel',
      class extends Base {
        constructor(name: string) {
          super(name)
          opened(name)
        }
      }
    )
    const attach = vi.spyOn(manager, 'attach')

    const first = ws.startWebSession()
    const second = ws.startWebSession()
    await first

    expect(second).toBe(first)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(opened).toHaveBeenCalledExactlyOnceWith(WEB_SESSION_CHANNEL)
  })

  it('waits for the stored minutes', async () => {
    await load('60')

    await ws.startWebSession()

    expect(policy.autoLockMs()).toBe(60 * MINUTE)
  })

  it('applies the default for an invalid stored value', async () => {
    await load('7')

    await ws.startWebSession()

    expect(policy.autoLockMs()).toBe(30 * MINUTE)
  })

  it('enforces 5 minutes when the setting cannot be read', async () => {
    await load('{')

    await ws.startWebSession()

    expect(policy.autoLockMs()).toBe(5 * MINUTE)
  })

  it('keeps a change event that arrives during the first read', async () => {
    await load('5')

    const started = ws.startWebSession()
    window.dispatchEvent(
      Object.assign(new Event('storage'), {
        key: STORAGE_KEY_AUTO_LOCK_MINUTES,
        newValue: '60',
        storageArea: web.localStorage,
      })
    )
    await started

    expect(policy.autoLockMs()).toBe(60 * MINUTE)
  })

  it('follows another tab changing the minutes', async () => {
    await load('5')
    await ws.startWebSession()

    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '60')

    expect(policy.autoLockMs()).toBe(60 * MINUTE)
  })

  it('applies a same-tab setMinutes at once', async () => {
    await load('60')
    await ws.startWebSession()
    const { useAutoLock } = await import('./composables/useAutoLock')

    await useAutoLock().setMinutes(5)

    expect(policy.autoLockMs()).toBe(5 * MINUTE)
  })

  it('notifies wallets for another tab and for an own write of the wallet key only', async () => {
    await load()
    await ws.startWebSession()
    const { storageService } = await import('./storage/storage-service')
    const changes: string[] = []
    ws.onWebSessionChange((change) => changes.push(change))

    web.emitStorageEvent(STORAGE_KEY_WALLETS, '{}')
    await storageService.set(STORAGE_KEY_WALLETS, { wallets: [] })
    web.emitStorageEvent('other-key', '1')
    await storageService.set('other-key', 1)

    expect(changes).toEqual(['wallets', 'wallets'])
  })

  it('stops notifying after unsubscribe', async () => {
    await load()
    await ws.startWebSession()
    const listener = vi.fn()
    ws.onWebSessionChange(listener)()

    web.emitStorageEvent(STORAGE_KEY_WALLETS, '{}')

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('web session expiry rules', () => {
  beforeEach(async () => {
    await load()
    await start()
  })

  it('expires a session whose shared activity jumps past the timeout between two checks', () => {
    manager.unlock(addressA, storeA)
    at(4 * MINUTE)
    expect(manager.isUnlocked(addressA)).toBe(true)

    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 8.5 * MINUTE))
    at(8.5 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('expires a session this tab did not check for longer than the timeout', () => {
    manager.unlock(addressA, storeA)
    web.localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(T0 + 4 * MINUTE))

    at(8 * MINUTE)

    expect(manager.isUnlocked(addressA)).toBe(false)
  })

  it('counts the gap from an unlock when no check ran in between', () => {
    manager.unlock(addressA, storeA)
    expect(manager.isUnlocked(addressA)).toBe(true)
    at(MINUTE)
    manager.lock(addressA)
    at(4 * MINUTE)
    manager.unlock(addressB, storeB)

    at(6 * MINUTE)

    expect(manager.isUnlocked(addressB)).toBe(true)
  })

  it('keeps other sessions when one wallet is locked', () => {
    manager.unlock(addressA, storeA)
    manager.unlock(addressB, storeB)
    at(MINUTE)
    manager.lock(addressA)

    at(MINUTE + 1000)

    expect(manager.getUnlockedAddresses()).toEqual([addressB])
    expect(web.localStorage.getItem(SESSION_KEY_LOCKED_AT)).toBeNull()
  })

  it('keeps a session unlocked in the same millisecond as lockAll', () => {
    manager.lockAll()
    manager.unlock(addressA, storeA)

    expect(manager.isUnlocked(addressA)).toBe(true)
    at(1000)
    expect(manager.isUnlocked(addressA)).toBe(true)
  })

  it('ignores a lock time later than now for a session unlocked now', () => {
    web.localStorage.setItem(SESSION_KEY_LOCKED_AT, String(T0 + 60 * MINUTE))
    manager.unlock(addressA, storeA)

    expect(manager.isUnlocked(addressA)).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyStore } from 'znn-typescript-sdk'

import { SessionManager } from '@/core/session-manager'

const SESSION_TIMEOUT_MS = 1_000
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000
const START_TIME = new Date('2026-01-01T00:00:00.000Z')

const createOpaqueKeyStore = () => ({}) as KeyStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START_TIME)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionManager', () => {
  it('retains and returns an unlocked opaque keystore', () => {
    const manager = new SessionManager(SESSION_TIMEOUT_MS)
    const keyStore = createOpaqueKeyStore()

    manager.unlock('address-1', keyStore)

    expect(manager.isUnlocked('address-1')).toBe(true)
    expect(manager.getKeyStore('address-1')).toBe(keyStore)
  })

  it('uses a 30-minute default timeout and expires only after the deadline', () => {
    const managerAtDeadline = new SessionManager()
    const managerAfterDeadline = new SessionManager()
    const keyStore = createOpaqueKeyStore()

    managerAtDeadline.unlock('address-1', keyStore)
    managerAfterDeadline.unlock('address-2', createOpaqueKeyStore())
    vi.advanceTimersByTime(DEFAULT_SESSION_TIMEOUT_MS)

    expect(managerAtDeadline.getKeyStore('address-1')).toBe(keyStore)

    vi.advanceTimersByTime(1)

    expect(managerAfterDeadline.getKeyStore('address-2')).toBeNull()
  })

  it('locks one address without locking another', () => {
    const manager = new SessionManager(SESSION_TIMEOUT_MS)
    const firstKeyStore = createOpaqueKeyStore()
    const secondKeyStore = createOpaqueKeyStore()

    manager.unlock('address-1', firstKeyStore)
    manager.unlock('address-2', secondKeyStore)
    manager.lock('address-1')

    expect(manager.getKeyStore('address-1')).toBeNull()
    expect(manager.getKeyStore('address-2')).toBe(secondKeyStore)
  })

  it('removes all sessions with lockAll', () => {
    const manager = new SessionManager(SESSION_TIMEOUT_MS)

    manager.unlock('address-1', createOpaqueKeyStore())
    manager.unlock('address-2', createOpaqueKeyStore())
    manager.lockAll()

    expect(manager.getKeyStore('address-1')).toBeNull()
    expect(manager.getKeyStore('address-2')).toBeNull()
    expect(manager.getUnlockedAddresses()).toEqual([])
  })

  it('lazily evicts an expired session when it is accessed', () => {
    const manager = new SessionManager(SESSION_TIMEOUT_MS)

    manager.unlock('address-1', createOpaqueKeyStore())
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS + 1)

    expect(manager.getKeyStore('address-1')).toBeNull()

    // A retained expired entry would become unlocked again after the clock rewinds.
    vi.setSystemTime(START_TIME)

    expect(manager.isUnlocked('address-1')).toBe(false)
    expect(manager.getKeyStore('address-1')).toBeNull()
    expect(manager.getUnlockedAddresses()).toEqual([])
  })

  it('filters an expired address while retaining a recent address', () => {
    const manager = new SessionManager(SESSION_TIMEOUT_MS)
    const recentKeyStore = createOpaqueKeyStore()

    manager.unlock('address-1', createOpaqueKeyStore())
    vi.advanceTimersByTime(600)
    manager.unlock('address-2', recentKeyStore)
    vi.advanceTimersByTime(SESSION_TIMEOUT_MS - 600 + 1)

    expect(manager.getUnlockedAddresses()).toEqual(['address-2'])

    // Rewind before retrieval so the listing must have removed the expired entry.
    vi.setSystemTime(new Date(START_TIME.getTime() + 600))

    expect(manager.getKeyStore('address-1')).toBeNull()
    expect(manager.getKeyStore('address-2')).toBe(recentKeyStore)
  })
})

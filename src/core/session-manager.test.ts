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

  describe('with a backend', () => {
    const createBackend = () => ({
      isExpired: vi.fn(() => false),
      unlocked: vi.fn(),
      locked: vi.fn(),
    })

    it('notifies the backend of unlock, lock and lockAll', () => {
      const manager = new SessionManager()
      const backend = createBackend()
      const keyStore = createOpaqueKeyStore()
      manager.attach(backend)

      manager.unlock('address-1', keyStore)
      manager.lock('address-1')
      manager.lockAll()

      expect(backend.unlocked).toHaveBeenCalledWith('address-1', keyStore)
      expect(backend.locked).toHaveBeenNthCalledWith(1, 'address-1')
      expect(backend.locked).toHaveBeenNthCalledWith(2, null)
    })

    it('restores and drops sessions without calling the backend', () => {
      const manager = new SessionManager()
      const backend = createBackend()
      manager.attach(backend)

      manager.restore('address-1', createOpaqueKeyStore())
      manager.restore('address-2', createOpaqueKeyStore())
      expect(manager.isUnlocked('address-1')).toBe(true)

      manager.drop('address-1')
      expect(manager.isUnlocked('address-1')).toBe(false)
      expect(manager.isUnlocked('address-2')).toBe(true)

      manager.drop(null)
      expect(manager.isUnlocked('address-2')).toBe(false)
      expect(backend.unlocked).not.toHaveBeenCalled()
      expect(backend.locked).not.toHaveBeenCalled()
    })

    it('defers expiry to the backend instead of the local timeout', () => {
      const manager = new SessionManager()
      const backend = createBackend()
      manager.attach(backend)
      manager.unlock('address-1', createOpaqueKeyStore())

      vi.advanceTimersByTime(31 * 60 * 1000)

      expect(manager.isUnlocked('address-1')).toBe(true)
    })

    it('locks and notifies the backend when it reports expiry', () => {
      const manager = new SessionManager()
      const backend = createBackend()
      manager.attach(backend)
      manager.unlock('address-1', createOpaqueKeyStore())
      backend.isExpired.mockReturnValue(true)

      expect(manager.isUnlocked('address-1')).toBe(false)
      expect(backend.locked).toHaveBeenCalledWith('address-1')
    })
  })
})

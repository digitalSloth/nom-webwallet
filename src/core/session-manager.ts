import { KeyStore } from 'znn-typescript-sdk'

export interface SessionBackend {
  isExpired(unlockedAt: number): boolean
  unlocked(address: string, keyStore: KeyStore): void
  locked(address: string | null): void // null = all
}

// Tier B (see ChainService header): public defaulted-DI ctor; the module-const below is the prod wrapper.
// In-memory session storage for unlocked wallets
export class SessionManager {
  private sessions: Map<string, { keyStore: KeyStore; unlockedAt: number }> = new Map()
  private sessionTimeout: number = 30 * 60 * 1000 // 30 minutes
  private backend: SessionBackend | undefined

  constructor(timeout?: number) {
    if (timeout) {
      this.sessionTimeout = timeout
    }
  }

  /** Mirrors unlocks, locks and expiry to a backend that shares sessions across documents. */
  attach(backend: SessionBackend): void {
    this.backend = backend
  }

  unlock(address: string, keyStore: KeyStore): void {
    this.sessions.set(address, {
      keyStore,
      unlockedAt: Date.now(),
    })
    this.backend?.unlocked(address, keyStore)
  }

  /** Adds a session that another document unlocked, without notifying the backend. */
  restore(address: string, keyStore: KeyStore): void {
    this.sessions.set(address, { keyStore, unlockedAt: Date.now() })
  }

  /** Removes one session, or all on null, without notifying the backend. */
  drop(address: string | null): void {
    if (address === null) this.sessions.clear()
    else this.sessions.delete(address)
  }

  lock(address: string): void {
    this.sessions.delete(address)
    this.backend?.locked(address)
  }

  lockAll(): void {
    this.sessions.clear()
    this.backend?.locked(null)
  }

  isUnlocked(address: string): boolean {
    const session = this.sessions.get(address)
    if (!session) return false

    // Check if session has expired
    const expired = this.backend
      ? this.backend.isExpired(session.unlockedAt)
      : Date.now() - session.unlockedAt > this.sessionTimeout
    if (expired) {
      this.lock(address)
      return false
    }

    return true
  }

  getKeyStore(address: string): KeyStore | null {
    if (!this.isUnlocked(address)) return null
    return this.sessions.get(address)?.keyStore ?? null
  }

  getUnlockedAddresses(): string[] {
    const addresses: string[] = []
    for (const [address] of this.sessions) {
      if (this.isUnlocked(address)) {
        addresses.push(address)
      }
    }
    return addresses
  }
}

// Global session manager instance
export const sessionManager = new SessionManager()

import { KeyStore } from 'znn-typescript-sdk'

// In-memory session storage for unlocked wallets
export class SessionManager {
  private sessions: Map<string, { keyStore: KeyStore; unlockedAt: number }> = new Map()
  private sessionTimeout: number = 30 * 60 * 1000 // 30 minutes

  constructor(timeout?: number) {
    if (timeout) {
      this.sessionTimeout = timeout
    }
  }

  unlock(address: string, keyStore: KeyStore): void {
    this.sessions.set(address, {
      keyStore,
      unlockedAt: Date.now(),
    })
  }

  lock(address: string): void {
    this.sessions.delete(address)
  }

  lockAll(): void {
    this.sessions.clear()
  }

  isUnlocked(address: string): boolean {
    const session = this.sessions.get(address)
    if (!session) return false

    // Check if session has expired
    const now = Date.now()
    if (now - session.unlockedAt > this.sessionTimeout) {
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

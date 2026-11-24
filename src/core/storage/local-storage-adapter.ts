import type {StorageAdapter} from '@/types'

/**
 * localStorage-based storage adapter for the web app environment.
 *
 * SECURITY NOTE: localStorage is accessible to any JavaScript running on the
 * same origin. An XSS vulnerability would allow an attacker to exfiltrate the
 * encrypted keyfile for offline brute-force attacks against the wallet password.
 * The Chrome extension uses chrome.storage.local which is origin-isolated.
 *
 * Mitigations for web deployments:
 * - Set a strict Content-Security-Policy header (script-src 'self')
 * - Avoid loading third-party scripts on the same origin
 * - Use Subresource Integrity (SRI) for any CDN-loaded assets
 */
export class LocalStorageAdapter implements StorageAdapter {
  private listeners = new Set<(key: string, value: unknown) => void>()
  private listening = false

  async get<T>(key: string): Promise<T | null> {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value))
    this.emit(key, value)
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key)
    this.emit(key, null)
  }

  onChange(listener: (key: string, value: unknown) => void): () => void {
    if (!this.listening) {
      this.listening = true
      window.addEventListener('storage', (event: StorageEvent) => {
        // A null key is a clear(), and another storage area is not ours.
        if (event.key === null || event.storageArea !== localStorage) return
        let value: unknown = null
        if (event.newValue !== null) {
          try {
            value = JSON.parse(event.newValue)
          } catch {
            value = null
          }
        }
        this.emit(event.key, value)
      })
    }
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(key: string, value: unknown): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(key, value)
      } catch (error) {
        console.error('Storage change listener failed.', error)
      }
    }
  }
}

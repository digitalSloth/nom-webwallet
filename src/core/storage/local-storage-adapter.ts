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
  async get<T>(key: string): Promise<T | null> {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value))
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key)
  }
}

import type {StorageAdapter} from '@/types'
import {LocalStorageAdapter} from './local-storage-adapter'
import {ChromeStorageAdapter} from './chrome-storage-adapter'

/**
 * Storage service that automatically selects the appropriate storage adapter
 * based on the environment (browser or Chrome extension)
 */
class StorageService implements StorageAdapter {
  private adapter: StorageAdapter

  constructor() {
    this.adapter = this.detectAdapter()
  }

  /**
   * Detects whether the app is running as a Chrome extension or in a browser
   * and returns the appropriate storage adapter
   */
  private detectAdapter(): StorageAdapter {
    // Check if Chrome extension API is available
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        // Verify we can actually access chrome.storage
        // This will throw if we're in a regular browser context
        void chrome.storage.local.get
        return new ChromeStorageAdapter()
      } catch {
        // Fall back to localStorage if chrome.storage is not accessible
        return new LocalStorageAdapter()
      }
    }

    // Default to localStorage for regular browser context
    return new LocalStorageAdapter()
  }

  /**
   * Get a value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    return this.adapter.get<T>(key)
  }

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    return this.adapter.set(key, value)
  }

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<void> {
    return this.adapter.remove(key)
  }

  /**
   * Get the current adapter type for debugging purposes
   */
  getAdapterType(): string {
    return this.adapter instanceof ChromeStorageAdapter ? 'chrome' : 'local'
  }
}

// Export a singleton instance
export const storageService = new StorageService()

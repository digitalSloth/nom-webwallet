import type { StorageAdapter } from '@/types'

export class ChromeStorageAdapter implements StorageAdapter {
  async get<T>(key: string): Promise<T | null> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome storage API not available')
    }

    const result = await chrome.storage.local.get(key)
    return result[key] ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome storage API not available')
    }

    await chrome.storage.local.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome storage API not available')
    }

    await chrome.storage.local.remove(key)
  }
}

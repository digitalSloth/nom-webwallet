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

  onChange(listener: (key: string, value: unknown) => void): () => void {
    if (typeof chrome === 'undefined' || !chrome.storage) {
      throw new Error('Chrome storage API not available')
    }

    const handle = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local') return
      for (const [key, change] of Object.entries(changes)) {
        listener(key, change.newValue ?? null)
      }
    }
    chrome.storage.onChanged.addListener(handle)
    return () => chrome.storage.onChanged.removeListener(handle)
  }
}

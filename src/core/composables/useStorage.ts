import { storageService } from '../storage/storage-service'

/**
 * Composable for accessing the storage service
 * Automatically uses the appropriate storage adapter (localStorage or chrome.storage)
 * based on the runtime environment
 */
export function useStorage() {
  /**
   * Get a value from storage
   * @param key - The storage key
   * @returns The stored value or null if not found
   */
  async function get<T>(key: string): Promise<T | null> {
    return storageService.get<T>(key)
  }

  /**
   * Set a value in storage
   * @param key - The storage key
   * @param value - The value to store
   */
  async function set<T>(key: string, value: T): Promise<void> {
    return storageService.set(key, value)
  }

  /**
   * Remove a value from storage
   * @param key - The storage key
   */
  async function remove(key: string): Promise<void> {
    return storageService.remove(key)
  }

  /**
   * Get the current storage adapter type
   * Useful for debugging
   * @returns 'chrome' or 'local'
   */
  function getAdapterType(): string {
    return storageService.getAdapterType()
  }

  return {
    get,
    set,
    remove,
    getAdapterType,
  }
}

import type { IKeyValueStorage } from '@walletconnect/keyvaluestorage'
import type { StorageAdapter } from '@/types'
import { storageService } from './storage-service'
import { WC_STORAGE_PREFIX } from '@/config'

/**
 * `SignClient.init({storage})` accepts a custom store, which keeps WalletConnect
 * state in the same place as wallet state in both delivery modes. `StorageAdapter`
 * has no enumeration method, so this class maintains its own index — one extra key,
 * `${prefix}__index`, holding the list of WalletConnect key names — rather than
 * widening the shared three-method interface for this one consumer.
 */
export class WalletConnectStorage implements IKeyValueStorage {
  // Every mutation is serialised through this promise: sign-client's keychain,
  // subscription, pairing and session stores each write independently with no
  // serialisation of their own, and two overlapping read-modify-writes of the
  // index would drop a key name — the corresponding record then silently
  // vanishes from the next init().
  private tail: Promise<unknown> = Promise.resolve()

  constructor(
    private storage: StorageAdapter = storageService,
    private prefix: string = WC_STORAGE_PREFIX
  ) {}

  private indexKey(): string {
    return `${this.prefix}__index`
  }

  private async readIndex(): Promise<string[]> {
    const index = await this.storage.get<string[]>(this.indexKey())
    // A corrupt or missing index is treated as empty: sign-client re-pairs
    // rather than crashing.
    return Array.isArray(index) ? index : []
  }

  private mutateIndex(mutate: (index: string[]) => string[]): Promise<void> {
    const next = this.tail.then(async () => {
      const index = await this.readIndex()
      await this.storage.set(this.indexKey(), mutate(index))
    })
    this.tail = next
    return next
  }

  async getKeys(): Promise<string[]> {
    return this.readIndex()
  }

  async getEntries<T>(): Promise<[string, T][]> {
    const keys = await this.readIndex()
    const entries: [string, T][] = []
    for (const key of keys) {
      const value = await this.storage.get<T>(`${this.prefix}${key}`)
      if (value !== null) entries.push([key, value])
    }
    return entries
  }

  async getItem<T>(key: string): Promise<T | undefined> {
    // StorageAdapter.get returns null for an absent key; sign-client's Store
    // treats null as a present value, so this must normalise to undefined.
    const value = await this.storage.get<T>(`${this.prefix}${key}`)
    return value === null ? undefined : value
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    await this.storage.set(`${this.prefix}${key}`, value)
    await this.mutateIndex((index) => (index.includes(key) ? index : [...index, key]))
  }

  async removeItem(key: string): Promise<void> {
    await this.storage.remove(`${this.prefix}${key}`)
    // Update the index even when the value was already absent.
    await this.mutateIndex((index) => index.filter((k) => k !== key))
  }
}

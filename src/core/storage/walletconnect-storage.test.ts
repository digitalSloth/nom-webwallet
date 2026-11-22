import { describe, expect, it } from 'vitest'

import type { StorageAdapter } from '@/types'
import { WalletConnectStorage } from '@/core/storage/walletconnect-storage'

const PREFIX = 'wc@test:'
const INDEX_KEY = `${PREFIX}__index`

/** An in-memory adapter whose next index write can be made to fail once. */
function flakyStorage() {
  const data = new Map<string, unknown>()
  const state = { failNextIndexWrite: false }
  const adapter: StorageAdapter = {
    async get<T>(key: string): Promise<T | null> {
      return (data.get(key) as T | undefined) ?? null
    },
    async set<T>(key: string, value: T): Promise<void> {
      if (key === INDEX_KEY && state.failNextIndexWrite) {
        state.failNextIndexWrite = false
        throw new Error('storage unavailable')
      }
      data.set(key, value)
    },
    async remove(key: string): Promise<void> {
      data.delete(key)
    },
  }
  return { adapter, data, state }
}

describe('WalletConnectStorage index queue', () => {
  it('reports a failed index write to its caller and keeps serving later writes', async () => {
    const { adapter, state } = flakyStorage()
    const storage = new WalletConnectStorage(adapter, PREFIX)

    state.failNextIndexWrite = true
    await expect(storage.setItem('a', 1)).rejects.toThrow('storage unavailable')

    await storage.setItem('b', 2)
    await storage.setItem('c', 3)

    expect(await storage.getKeys()).toEqual(['b', 'c'])
    expect(await storage.getItem('b')).toBe(2)
  })

  it('runs index updates queued behind a failed one', async () => {
    const { adapter, state } = flakyStorage()
    const storage = new WalletConnectStorage(adapter, PREFIX)

    state.failNextIndexWrite = true
    const results = await Promise.allSettled([
      storage.setItem('a', 1),
      storage.setItem('b', 2),
      storage.setItem('c', 3),
    ])

    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    expect(await storage.getKeys()).toEqual(['b', 'c'])
  })
})

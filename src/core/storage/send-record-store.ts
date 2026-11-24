import { WEB_SEND_DB_NAME, WEB_SEND_STORE } from '@/config'
import type { SendRecord } from '../send-record'

export interface SendRecordStore {
  /** Resolves once the write commits. `durable: true` asks for a flushed commit. */
  put(record: SendRecord, options: { durable: boolean }): Promise<void>
  remove(id: string): Promise<void>
  /** Deletes the record in one transaction; true only when it was stored at `stage`. */
  take(id: string, stage: SendRecord['stage']): Promise<boolean>
  /** Deletes every record whose sending account is in `addresses`. */
  removeFrom(addresses: ReadonlySet<string>): Promise<void>
  /** Every stored value, unvalidated. */
  list(): Promise<unknown[]>
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(WEB_SEND_DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WEB_SEND_STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
    request.onblocked = () => reject(new Error('IndexedDB open blocked'))
  })
}

/** IndexedDB store. Opens on first use; every call runs its transaction in call order. */
export function openSendRecordStore(): SendRecordStore {
  let db: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => (db ??= open())

  // The transaction is created synchronously after the shared open promise
  // resolves, so transactions start in the order the methods were called.
  async function run<T>(
    mode: IDBTransactionMode,
    durability: IDBTransactionDurability,
    work: (store: IDBObjectStore) => IDBRequest<T> | void
  ): Promise<T | undefined> {
    const conn = await database()
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = conn.transaction(WEB_SEND_STORE, mode, { durability })
      const request = work(tx.objectStore(WEB_SEND_STORE))
      tx.oncomplete = () => resolve(request ? request.result : undefined)
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  }

  return {
    async put(record, options) {
      await run('readwrite', options.durable ? 'strict' : 'relaxed', (s) => {
        s.put(record)
      })
    },
    async remove(id) {
      await run('readwrite', 'relaxed', (s) => {
        s.delete(id)
      })
    },
    async take(id, stage) {
      const conn = await database()
      return new Promise<boolean>((resolve, reject) => {
        const tx = conn.transaction(WEB_SEND_STORE, 'readwrite', { durability: 'relaxed' })
        const objects = tx.objectStore(WEB_SEND_STORE)
        let taken = false
        const read = objects.get(id)
        read.onsuccess = () => {
          if ((read.result as SendRecord | undefined)?.stage !== stage) return
          taken = true
          objects.delete(id)
        }
        tx.oncomplete = () => resolve(taken)
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    },
    async removeFrom(addresses) {
      const conn = await database()
      return new Promise<void>((resolve, reject) => {
        const tx = conn.transaction(WEB_SEND_STORE, 'readwrite', { durability: 'relaxed' })
        const objects = tx.objectStore(WEB_SEND_STORE)
        const all = objects.getAll()
        all.onsuccess = () => {
          for (const value of all.result as SendRecord[]) {
            if (addresses.has(value?.context?.from)) objects.delete(value.id)
          }
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
      })
    },
    async list() {
      return (await run<unknown[]>('readonly', 'default', (s) => s.getAll())) ?? []
    },
  }
}

/** In-memory store for tests. Settles with resolved promises only. */
export function createMemorySendRecordStore(): SendRecordStore {
  const records = new Map<string, SendRecord>()
  return {
    put(record) {
      records.set(record.id, structuredClone(record))
      return Promise.resolve()
    },
    remove(id) {
      records.delete(id)
      return Promise.resolve()
    },
    take(id, stage) {
      const found = records.get(id)
      if (found?.stage !== stage) return Promise.resolve(false)
      records.delete(id)
      return Promise.resolve(true)
    },
    removeFrom(addresses) {
      for (const [id, record] of records) if (addresses.has(record.context.from)) records.delete(id)
      return Promise.resolve()
    },
    list() {
      return Promise.resolve([...records.values()].map((r) => structuredClone(r)))
    },
  }
}

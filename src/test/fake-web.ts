import { vi } from 'vitest'

/**
 * A minimal in-memory web environment: a `window` event target, a Map-backed
 * `localStorage` and a `BroadcastChannel` that delivers between instances.
 * Nothing uses `setTimeout`, so the fakes work under fake timers.
 */

export interface FakeWeb {
  localStorage: Storage
  /** Writes (or removes, for null) `key` as another tab would, then fires `storage` on window. */
  emitStorageEvent(key: string | null, newValue: string | null): void
}

function createStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: unknown) => {
      data.set(key, String(value))
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    clear: () => data.clear(),
  }
}

const openChannels = new Set<FakeBroadcastChannel>()
const deliveries: Promise<void>[] = []

class FakeBroadcastChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null

  constructor(readonly name: string) {
    openChannels.add(this)
  }

  postMessage(data: unknown): void {
    const copy = structuredClone(data)
    for (const other of openChannels) {
      if (other === this || other.name !== this.name) continue
      deliveries.push(
        new Promise<void>((resolve) => {
          queueMicrotask(() => {
            other.onmessage?.({ data: copy })
            resolve()
          })
        })
      )
    }
  }

  close(): void {
    openChannels.delete(this)
  }
}

/** Stubs `window` (an EventTarget), `localStorage` and `BroadcastChannel` with vi.stubGlobal. */
export function installFakeWeb(): FakeWeb {
  openChannels.clear()
  deliveries.length = 0
  const localStorage = createStorage()
  const window = new EventTarget()
  vi.stubGlobal('window', window)
  vi.stubGlobal('localStorage', localStorage)
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

  return {
    localStorage,
    emitStorageEvent(key, newValue) {
      if (key === null) localStorage.clear()
      else if (newValue === null) localStorage.removeItem(key)
      else localStorage.setItem(key, newValue)
      window.dispatchEvent(
        Object.assign(new Event('storage'), { key, newValue, storageArea: localStorage })
      )
    },
  }
}

/** Resolves after queued channel deliveries have run. */
export async function flushChannels(): Promise<void> {
  while (deliveries.length > 0) await Promise.all(deliveries.splice(0))
}

export interface FakeLocks {
  /** Names of the locks currently held. */
  held(): string[]
  /** Drops a held lock, as the browser does when the holding tab closes. */
  release(name: string): void
}

/** Stubs `navigator` with `locks`: `request` records the name and runs the callback in a microtask; `query` resolves `{ held: [{ name, mode: 'exclusive' }], pending: [] }`. */
export function installFakeLocks(): FakeLocks {
  const held = new Set<string>()
  const locks = {
    request(name: string, callback: () => unknown): Promise<unknown> {
      held.add(name)
      return new Promise((resolve, reject) => {
        queueMicrotask(() => {
          try {
            resolve(callback())
          } catch (err) {
            reject(err)
          }
        })
      })
    },
    query: () =>
      Promise.resolve({
        held: [...held].map((name) => ({ name, mode: 'exclusive' })),
        pending: [],
      }),
  }
  vi.stubGlobal('navigator', { locks })
  return {
    held: () => [...held],
    release: (name) => {
      held.delete(name)
    },
  }
}

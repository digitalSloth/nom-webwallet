import { vi } from 'vitest'

/**
 * A minimal in-memory `chrome` for the service-worker modules. Every storage
 * call yields to the event loop before it reads or writes, so two
 * read-modify-writes that are not serialised really do interleave, the way
 * they can against chrome.storage.
 */

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export interface FakeStorageArea {
  data: Record<string, unknown>
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}

export function createFakeStorageArea(): FakeStorageArea {
  const data: Record<string, unknown> = {}
  return {
    data,
    async get(key) {
      await yieldToEventLoop()
      return key in data ? { [key]: structuredClone(data[key]) } : {}
    },
    async set(items) {
      await yieldToEventLoop()
      for (const [key, value] of Object.entries(items)) data[key] = structuredClone(value)
    },
    async remove(key) {
      await yieldToEventLoop()
      delete data[key]
    },
  }
}

export interface FakePort {
  name: string
  sender: { origin: string; tab: { id: number; url?: string; title?: string }; frameId: number }
  posted: unknown[]
  postMessage: (message: unknown) => void
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
  disconnect: () => void
  /** Delivers a message as if the content script had posted it. */
  receive: (message: unknown) => void
}

export function createFakePort(origin: string, tabId: number, frameId = 0): FakePort {
  const listeners: ((message: unknown) => void)[] = []
  const posted: unknown[] = []
  return {
    name: 'znn-provider',
    sender: { origin, tab: { id: tabId, url: origin, title: 'dApp' }, frameId },
    posted,
    postMessage: (message) => posted.push(message),
    onMessage: { addListener: (listener) => listeners.push(listener) },
    onDisconnect: { addListener: () => {} },
    disconnect: () => {},
    receive: (message) => listeners.forEach((listener) => listener(message)),
  }
}

export function installFakeChrome() {
  const local = createFakeStorageArea()
  const session = createFakeStorageArea()
  const connectListeners: ((port: FakePort) => void)[] = []

  const fake = {
    storage: {
      local,
      session,
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://wallet/${path}`,
      onMessage: { addListener: vi.fn() },
      onConnect: {
        addListener: (listener: (port: FakePort) => void) => connectListeners.push(listener),
      },
    },
    windows: {
      create: vi.fn(async () => ({ id: 101 })),
      update: vi.fn(async () => ({})),
    },
  }

  vi.stubGlobal('chrome', fake)
  vi.stubGlobal('__IS_EXTENSION__', true)

  return {
    chrome: fake,
    local,
    session,
    /** Opens a provider port as a content script would. */
    connect(port: FakePort) {
      connectListeners.forEach((listener) => listener(port))
    },
  }
}

/** Lets every queued storage call (each a macrotask hop) run to completion. */
export async function settleStorage(): Promise<void> {
  for (let i = 0; i < 50; i++) await yieldToEventLoop()
}

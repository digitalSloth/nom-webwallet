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

type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>
type EmitChanges = (changes: StorageChanges, areaName: string) => void

export interface FakeStorageArea {
  data: Record<string, unknown>
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  setAccessLevel: ReturnType<typeof vi.fn>
}

export function createFakeStorageArea(
  areaName = 'local',
  emit: EmitChanges = () => {}
): FakeStorageArea {
  const data: Record<string, unknown> = {}
  return {
    data,
    async get(keys) {
      await yieldToEventLoop()
      if (keys === undefined || keys === null) return structuredClone(data)
      const wanted = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(
        wanted.filter((key) => key in data).map((key) => [key, structuredClone(data[key])])
      )
    },
    async set(items) {
      await yieldToEventLoop()
      const changes: StorageChanges = {}
      for (const [key, value] of Object.entries(items)) {
        changes[key] = key in data ? { oldValue: data[key], newValue: value } : { newValue: value }
        data[key] = structuredClone(value)
      }
      emit(changes, areaName)
    },
    async remove(keys) {
      await yieldToEventLoop()
      const changes: StorageChanges = {}
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (!(key in data)) continue
        changes[key] = { oldValue: data[key] }
        delete data[key]
      }
      emit(changes, areaName)
    },
    setAccessLevel: vi.fn(async () => {}),
  }
}

export interface FakePort {
  name: string
  sender: {
    origin: string
    tab: { id: number; url?: string; title?: string; windowId: number }
    frameId: number
  }
  posted: unknown[]
  postMessage: (message: unknown) => void
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  onDisconnect: { addListener: (listener: () => void) => void }
  disconnect: () => void
  /** Delivers a message as if the content script had posted it. */
  receive: (message: unknown) => void
}

export function createFakePort(
  origin: string,
  tabId: number,
  frameId = 0,
  windowId = 202
): FakePort {
  const listeners: ((message: unknown) => void)[] = []
  const posted: unknown[] = []
  return {
    name: 'znn-provider',
    sender: { origin, tab: { id: tabId, url: origin, title: 'dApp', windowId }, frameId },
    posted,
    postMessage: (message) => posted.push(message),
    onMessage: { addListener: (listener) => listeners.push(listener) },
    onDisconnect: { addListener: () => {} },
    disconnect: () => {},
    receive: (message) => listeners.forEach((listener) => listener(message)),
  }
}

export interface FakePanelPort {
  name: string
  sender: { id: string; url: string; origin: string; documentId?: string; tab?: { id: number } }
  onDisconnect: { addListener: (listener: () => void) => void }
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  /** Delivers a message as if the panel had posted it. */
  receive: (message: unknown) => void
  /** Fires the worker-side disconnect listeners, as a closing panel does. */
  close: () => void
}

/**
 * The worker's end of a port opened by a side panel (or by whatever `url` names).
 * Chrome sets only `{ id, url, origin }` on a side panel's sender.
 */
export function createFakePanelPort(
  url = 'chrome-extension://wallet/sidepanel.html'
): FakePanelPort {
  const disconnectListeners: (() => void)[] = []
  const messageListeners: ((message: unknown) => void)[] = []
  return {
    name: 'znn-side-panel',
    sender: { id: 'wallet', url, origin: 'chrome-extension://wallet' },
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    receive: (message) => messageListeners.forEach((listener) => listener(message)),
    close: () => disconnectListeners.forEach((listener) => listener()),
  }
}

export interface FakeContext {
  documentId?: string
  documentUrl?: string
  frameId: number
  contextType?: string
  windowId?: number
  tabId?: number
}

/** The identity token a fake panel with `documentId` carries by default. */
export function panelTokenFor(documentId: string): string {
  return `token-${documentId}`
}

/** A SIDE_PANEL top frame as Chrome reports it: no window, no tab, and the tagged URL. */
export function sidePanelContext(
  documentId = 'panel-doc',
  token = panelTokenFor(documentId)
): FakeContext {
  return {
    contextType: 'SIDE_PANEL',
    frameId: 0,
    windowId: -1,
    tabId: -1,
    documentId,
    documentUrl: `chrome-extension://wallet/sidepanel.html?panel=${token}#/`,
  }
}

interface ContextFilter {
  documentIds?: string[]
  contextTypes?: string[]
  windowIds?: number[]
  tabIds?: number[]
}

function matchesFilter(context: FakeContext, filter: ContextFilter): boolean {
  const { documentIds, contextTypes, windowIds, tabIds } = filter
  if (documentIds && !documentIds.includes(context.documentId ?? '')) return false
  if (contextTypes && !contextTypes.includes(context.contextType ?? '')) return false
  if (windowIds && !windowIds.includes(context.windowId ?? -1)) return false
  if (tabIds && !tabIds.includes(context.tabId ?? -1)) return false
  return true
}

export interface FakeClientPort {
  name: string
  onDisconnect: { addListener: (listener: () => void) => void }
  onMessage: { addListener: (listener: (message: unknown) => void) => void }
  postMessage: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  /** Fires the page-side disconnect listeners, as a stopped worker does. */
  drop: () => void
}

function createFakeClientPort(name: string): FakeClientPort {
  const disconnectListeners: (() => void)[] = []
  return {
    name,
    onDisconnect: { addListener: (listener) => disconnectListeners.push(listener) },
    onMessage: { addListener: () => {} },
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    drop: () => disconnectListeners.forEach((listener) => listener()),
  }
}

export function installFakeChrome(options: { emitChanges?: boolean } = {}) {
  const changeListeners: ((changes: StorageChanges, areaName: string) => void)[] = []
  const deliver: EmitChanges = (changes, areaName) =>
    changeListeners.forEach((listener) => listener(changes, areaName))
  const emit: EmitChanges = (changes, areaName) => {
    if (options.emitChanges) deliver(changes, areaName)
  }
  const local = createFakeStorageArea('local', emit)
  const session = createFakeStorageArea('session', emit)
  const connectListeners: ((port: FakePort | FakePanelPort) => void)[] = []
  const clientPorts: FakeClientPort[] = []
  const contexts: FakeContext[] = []

  const fake = {
    storage: {
      local,
      session,
      onChanged: {
        addListener: vi.fn((listener: (changes: StorageChanges, areaName: string) => void) => {
          changeListeners.push(listener)
        }),
        removeListener: vi.fn((listener: (changes: StorageChanges, areaName: string) => void) => {
          const index = changeListeners.indexOf(listener)
          if (index >= 0) changeListeners.splice(index, 1)
        }),
      },
    },
    tabs: {
      getCurrent: vi.fn(async (): Promise<{ id: number } | undefined> => undefined),
    },
    runtime: {
      // Answers from `contexts` the way Chrome does: every filter field must match.
      getContexts: vi.fn(
        async (filter?: unknown): Promise<FakeContext[]> =>
          contexts.filter((context) => matchesFilter(context, (filter ?? {}) as ContextFilter))
      ),
      connect: vi.fn((info: { name: string }) => {
        const port = createFakeClientPort(info.name)
        clientPorts.push(port)
        return port
      }),
      getURL: (path: string) => `chrome-extension://wallet/${path}`,
      // The parameter types the calls that tests read from `mock.calls`.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      sendMessage: vi.fn(async (_message: unknown): Promise<unknown> => undefined),
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onConnect: {
        addListener: (listener: (port: FakePort | FakePanelPort) => void) =>
          connectListeners.push(listener),
      },
    },
    windows: {
      create: vi.fn(async () => ({ id: 101 })),
      update: vi.fn(async () => ({})),
      getAll: vi.fn(async () => []),
      getCurrent: vi.fn(async (): Promise<{ id?: number }> => ({ id: 202 })),
    },
    action: {
      // The parameter types the calls that tests read from `mock.calls`.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setPopup: vi.fn(async (_details: { popup: string }) => {}),
    },
    sidePanel: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      open: vi.fn(async (_options: { windowId: number }) => {}),
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      setPanelBehavior: vi.fn(async (_behavior: { openPanelOnActionClick: boolean }) => {}),
    },
    alarms: {
      create: vi.fn(async () => {}),
      clear: vi.fn(async () => true),
      onAlarm: { addListener: vi.fn() },
    },
  }

  vi.stubGlobal('chrome', fake)
  vi.stubGlobal('__IS_EXTENSION__', true)

  return {
    chrome: fake,
    local,
    session,
    /** Delivers storage changes to onChanged listeners regardless of `emitChanges`. */
    emitStorageChange: deliver,
    /** The live extension contexts `runtime.getContexts` filters. Push `sidePanelContext()` to open a panel. */
    contexts,
    /** Ports a page opened with `chrome.runtime.connect`, in order. */
    clientPorts,
    /** Registers a `sidePanel.onClosed` and returns the function that fires it. */
    installOnClosed() {
      const listeners: ((info: { windowId?: number; path?: string }) => void)[] = []
      ;(fake.sidePanel as Record<string, unknown>).onClosed = {
        addListener: (listener: (info: { windowId?: number; path?: string }) => void) =>
          listeners.push(listener),
      }
      return (info: { windowId?: number; path?: string }) => listeners.forEach((l) => l(info))
    },
    /** Opens a provider port as a content script would. */
    connect(port: FakePort | FakePanelPort) {
      connectListeners.forEach((listener) => listener(port))
    },
  }
}

/** Lets every queued storage call (each a macrotask hop) run to completion. */
export async function settleStorage(): Promise<void> {
  for (let i = 0; i < 50; i++) await yieldToEventLoop()
}

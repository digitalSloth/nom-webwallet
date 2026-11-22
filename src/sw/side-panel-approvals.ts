import { SESSION_KEY_SIDE_PANELS, STORAGE_KEY_SIDE_PANEL } from '@/config'
import { SIDE_PANEL_PORT_NAME, type SidePanelHelloMessage } from '@/core/inpage-protocol'
import { panelDocumentIdFor } from '@/core/panel-token'
import { APPROVAL_CLOSED_ERROR, listInbox, rejectEntriesForPanel } from './approval-inbox'

/**
 * Routes dApp requests to a side panel and rejects them when it closes.
 * The worker never opens the panel: `sidePanel.open` needs a user gesture
 * that does not survive the page, content script and port hops, and it would
 * let a web page open the wallet's panel. A request goes to the panel only
 * when the panel is already open in the requesting tab's window; every other
 * request uses the approval window.
 *
 * Chrome reports `windowId: -1` for a SIDE_PANEL context, so the worker
 * cannot find a panel by window. Each panel holds a `znn-side-panel` port
 * for its whole lifetime and posts its window id and identity token on it
 * (see `panel-token.ts`). The worker accepts the port only when the token
 * names exactly one SIDE_PANEL top frame, then records
 * window id -> document id in a session registry. The port's disconnect,
 * `sidePanel.onClosed` where Chrome has it, and the sweep at each worker
 * start are the close signals. Listeners register at module top level so
 * any of them wakes a stopped worker.
 */

type PanelRegistry = Record<string, string>

// One registry read-modify-write at a time.
let registryQueue: Promise<unknown> = Promise.resolve()

function withRegistry<T>(update: (registry: PanelRegistry) => T): Promise<T> {
  const run = registryQueue.then(async () => {
    const stored = await chrome.storage.session.get(SESSION_KEY_SIDE_PANELS)
    const registry = { ...(stored[SESSION_KEY_SIDE_PANELS] as PanelRegistry | undefined) }
    const result = update(registry)
    await chrome.storage.session.set({ [SESSION_KEY_SIDE_PANELS]: registry })
    return result
  })
  registryQueue = run.catch(() => {})
  return run
}

async function readRegistry(): Promise<PanelRegistry> {
  const stored = await chrome.storage.session.get(SESSION_KEY_SIDE_PANELS)
  return (stored[SESSION_KEY_SIDE_PANELS] as PanelRegistry | undefined) ?? {}
}

/** True when `documentId` is exactly one live SIDE_PANEL top frame. The context's own window id is -1 and unused. */
async function isLivePanel(documentId: string): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ documentIds: [documentId] })
  return (
    contexts.length === 1 && contexts[0].contextType === 'SIDE_PANEL' && contexts[0].frameId === 0
  )
}

/**
 * The browser window whose side panel shows a request from a tab in
 * `tabWindowId`, or undefined when the approval window shows it. Never rejects.
 */
export async function panelWindowFor(tabWindowId: number | undefined): Promise<number | undefined> {
  if (tabWindowId === undefined || tabWindowId < 0) return undefined
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_SIDE_PANEL)
    if (stored[STORAGE_KEY_SIDE_PANEL] !== true) return undefined
    const documentId = (await readRegistry())[String(tabWindowId)]
    if (documentId === undefined) return undefined
    return (await isLivePanel(documentId)) ? tabWindowId : undefined
  } catch (err) {
    console.warn('Could not look up the side panel.', err)
    return undefined
  }
}

/**
 * Rejects the entries of every side panel that is no longer open and drops
 * the stale registry records. Never rejects.
 */
export async function rejectClosedPanels(): Promise<void> {
  try {
    const registry = await readRegistry()
    const inbox = await listInbox()
    const windowIds = new Set<string>(Object.keys(registry))
    for (const entry of inbox) {
      if (entry.panelWindowId !== undefined) windowIds.add(String(entry.panelWindowId))
    }
    for (const windowId of windowIds) {
      try {
        const documentId = registry[windowId]
        if (documentId !== undefined && (await isLivePanel(documentId))) continue
        if (documentId !== undefined) {
          await withRegistry((current) => {
            if (current[windowId] === documentId) delete current[windowId]
          })
        }
        await rejectEntriesForPanel(Number(windowId), APPROVAL_CLOSED_ERROR)
      } catch (err) {
        console.warn('Could not check a side panel.', err)
      }
    }
  } catch (err) {
    console.warn('Could not sweep closed side panels.', err)
  }
}

/**
 * The document id of the side panel that sent `sender` with `token`, or
 * undefined when it is anything else. Chrome gives a panel's sender only
 * `{ id, url, origin }`, so the panel is the one SIDE_PANEL top frame whose
 * `documentUrl` carries the token.
 */
async function verifiedPanelDocument(
  sender: chrome.runtime.MessageSender | undefined,
  token: string
): Promise<string | undefined> {
  try {
    if (!sender?.url || sender.tab !== undefined) return undefined
    if (sender.url.split(/[?#]/)[0] !== chrome.runtime.getURL('sidepanel.html')) return undefined
    const documentId = await panelDocumentIdFor(token)
    if (documentId === undefined) return undefined
    if (sender.documentId !== undefined && sender.documentId !== documentId) return undefined
    return documentId
  } catch (err) {
    console.warn('Could not verify the side panel.', err)
    return undefined
  }
}

function isHello(message: unknown): message is SidePanelHelloMessage {
  const hello = message as Partial<SidePanelHelloMessage> | null
  return (
    typeof hello === 'object' &&
    hello !== null &&
    Number.isInteger(hello.windowId) &&
    (hello.windowId as number) >= 0 &&
    typeof hello.token === 'string' &&
    hello.token !== ''
  )
}

async function closePanelWindow(windowId: number, documentId?: string): Promise<void> {
  await withRegistry((registry) => {
    if (documentId === undefined || registry[String(windowId)] === documentId) {
      delete registry[String(windowId)]
    }
  })
  await rejectEntriesForPanel(windowId, APPROVAL_CLOSED_ERROR)
}

async function dropRecord(windowId: number, documentId: string): Promise<void> {
  await withRegistry((registry) => {
    if (registry[String(windowId)] === documentId) delete registry[String(windowId)]
  })
}

void rejectClosedPanels()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== SIDE_PANEL_PORT_NAME) return
  // The panel sends a hello when it opens the port and again whenever its
  // document becomes visible, because a panel hidden by switching to another
  // panel is dropped from the registry while its port stays connected.
  let registered: { windowId: number; documentId: string } | undefined
  let chain: Promise<unknown> = Promise.resolve()

  const handleHello = async (greeting: SidePanelHelloMessage): Promise<void> => {
    const documentId = await verifiedPanelDocument(port.sender, greeting.token)
    const previous = registered
    if (documentId === undefined) {
      registered = undefined
      if (previous !== undefined) await dropRecord(previous.windowId, previous.documentId)
      return
    }
    registered = { windowId: greeting.windowId, documentId }
    await withRegistry((registry) => {
      if (previous !== undefined && previous.windowId !== greeting.windowId) {
        if (registry[String(previous.windowId)] === previous.documentId) {
          delete registry[String(previous.windowId)]
        }
      }
      registry[String(greeting.windowId)] = documentId
    })
  }

  port.onMessage.addListener((message: unknown) => {
    if (!isHello(message)) return
    chain = chain
      .then(() => handleHello(message))
      .catch((err: unknown) => console.error('Could not record the side panel.', err))
  })

  port.onDisconnect.addListener(() => {
    void chain
      .then(async () => {
        const panel = registered
        if (panel !== undefined) await closePanelWindow(panel.windowId, panel.documentId)
      })
      .catch((err: unknown) => console.error('Could not reject the closed side panel.', err))
  })
})

// Chrome 142+. Feature-detected: the manifest minimum is older.
const sidePanelApi = chrome.sidePanel as
  | (typeof chrome.sidePanel & {
      onClosed?: {
        addListener: (listener: (info: { windowId?: number; path?: string }) => void) => void
      }
    })
  | undefined
sidePanelApi?.onClosed?.addListener((info) => {
  if (typeof info?.windowId !== 'number') return
  if (typeof info.path === 'string' && !info.path.endsWith('sidepanel.html')) return
  closePanelWindow(info.windowId).catch((err: unknown) =>
    console.error('Could not reject the closed side panel.', err)
  )
})

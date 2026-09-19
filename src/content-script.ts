import type {
  InpageEventMessage,
  InpageRequestMessage,
  InpageResponseMessage,
  PortEventMessage,
  PortMessageFromWorker,
  ReadOnlyRequest,
  ReadOnlyResponse,
} from '@/core/inpage-protocol'

/**
 * Isolated-world relay between the page's window.zenon (src/inpage.ts) and
 * the service worker (§6.3, §6.4). Owns the provider port's lifecycle:
 * opened when the origin is granted or a prompting request is outstanding,
 * closed otherwise, reconnected immediately on disconnect with no backoff.
 *
 * Deliberately duplicates the wire-protocol string constants below rather
 * than importing them as values from inpage-protocol.ts: that module is also
 * imported by the service worker, and a runtime import shared across entries
 * makes crxjs wrap this content script in a dynamic-import loader instead of
 * a self-contained IIFE — subject to a visited page's CSP (§5.1). Type-only
 * imports above are erased at build and carry no such cost.
 */
const TARGET_CONTENT_SCRIPT = 'znn-contentscript'
const TARGET_INPAGE = 'znn-inpage'
const PROVIDER_PORT_NAME = 'znn-provider'
const PROVIDER_MESSAGE_CHANNEL = 'znn-provider'
const ZNN_IS_GRANTED = 'znn_isGranted'
const READ_ONLY_METHODS = new Set(['znn_accounts', 'znn_chainId', 'znn_nodeUrl', 'znn_disconnect'])

// A request whose id comes back `unknown` from a resync this many times in a
// row is genuinely lost, not just racing a reconnect (§6.4, edge case 32).
const MAX_UNKNOWN_BEFORE_GIVING_UP = 2
const LOST_REQUEST_ERROR = { code: -32603, message: 'Request was lost and could not be recovered.' }

interface OutstandingPrompt {
  pageId: string
  method: string
  params: unknown
  unknownCount: number
}

// Keyed by the content-script-minted port id (never the page's own id — see
// sendPrompting below).
const outstanding = new Map<string, OutstandingPrompt>()

let port: chrome.runtime.Port | null = null
// True only when this content script closed the port on purpose (revoke, or
// the tab unloading) — the signal that stops the no-backoff reconnect below.
let closedByUs = false

function replyToPage(pageId: string, result: unknown, error: InpageResponseMessage['error']): void {
  const reply: InpageResponseMessage = { target: TARGET_INPAGE, id: pageId, result, error }
  window.postMessage(reply, '*')
}

function forwardEvent(message: PortEventMessage): void {
  const forwarded: InpageEventMessage = {
    target: TARGET_INPAGE,
    kind: 'event',
    name: message.name,
    data: message.data,
  }
  window.postMessage(forwarded, '*')
}

function handlePortMessage(message: PortMessageFromWorker): void {
  switch (message.kind) {
    case 'event':
      forwardEvent(message)
      return

    case 'accepted':
      // Durably tracked by the worker now; nothing to do until its outcome.
      return

    case 'outcome': {
      const entry = outstanding.get(message.id)
      if (!entry) return
      outstanding.delete(message.id)
      replyToPage(entry.pageId, message.result, message.error)
      // A settled connect() may have just granted (or a rejection left the
      // origin ungranted) — re-check whether the port should stay open.
      if (outstanding.size === 0) void reconcileFromGrantState()
      return
    }

    case 'resyncResult': {
      let settledAny = false
      for (const id of message.unknown) {
        const entry = outstanding.get(id)
        if (!entry) continue

        entry.unknownCount += 1
        if (entry.unknownCount >= MAX_UNKNOWN_BEFORE_GIVING_UP) {
          outstanding.delete(id)
          settledAny = true
          replyToPage(entry.pageId, undefined, LOST_REQUEST_ERROR)
        } else {
          // Re-send silently — the canonical lost-request case is benign
          // (worker terminated or port dropped before its listener ran), and
          // idempotent request handling on the worker makes this safe even
          // if the original request actually did land (§6.4, edge case 27).
          port?.postMessage({ kind: 'request', id, method: entry.method, params: entry.params })
        }
      }
      if (settledAny && outstanding.size === 0) void reconcileFromGrantState()
      return
    }
  }
}

function openPort(): void {
  if (port) return
  closedByUs = false

  const opened = chrome.runtime.connect({ name: PROVIDER_PORT_NAME })
  opened.onMessage.addListener(handlePortMessage)
  opened.onDisconnect.addListener(() => {
    if (port === opened) port = null
    if (closedByUs) return

    if (outstanding.size > 0) {
      // Reconnect immediately, no backoff (§6.4) — an implementer who adds
      // backoff here silently breaks outcome delivery. No async detour here:
      // outstanding work must reopen the port unconditionally and promptly,
      // since the resync that recovers it depends on the port being back.
      openPort()
    } else {
      // Nothing outstanding — re-verify the grant before reopening. This is
      // what makes a revoke initiated from the settings dialog (rather than
      // the dApp's own disconnect()) actually stick: the worker disconnects
      // this port (§6.7), and without this check the port would otherwise
      // just reconnect right back.
      void reconcileFromGrantState()
    }
  })

  port = opened

  // On (re)connect, resync every request this frame is still waiting on —
  // the worker may have answered while the port was down.
  if (outstanding.size > 0) {
    port.postMessage({ kind: 'resync', ids: [...outstanding.keys()] })
  }
}

function closePort(): void {
  if (!port) return
  closedByUs = true
  port.disconnect()
  port = null
}

/** Opens/closes the port to match the origin's grant state and outstanding work (§6.4). */
function reconcilePort(granted: boolean): void {
  if (granted || outstanding.size > 0) openPort()
  else closePort()
}

function sendReadOnly(method: ReadOnlyRequest['method']): Promise<ReadOnlyResponse> {
  return chrome.runtime.sendMessage<ReadOnlyRequest, ReadOnlyResponse>({
    channel: PROVIDER_MESSAGE_CHANNEL,
    method,
  })
}

async function reconcileFromGrantState(): Promise<void> {
  const response = await sendReadOnly(ZNN_IS_GRANTED)
  reconcilePort(response.granted)
}

/** Mints the worker-facing id and sends a prompting request over the port (§6.4). */
function sendPrompting(pageId: string, method: string, params: unknown): void {
  const id = `ip:${crypto.randomUUID()}`
  outstanding.set(id, { pageId, method, params, unknownCount: 0 })
  // The content script ensures the port is open before relaying the request
  // — this is what lets a first-ever connect() work: the port exists before
  // the request is sent, so an outcome never has nowhere to go.
  openPort()
  port?.postMessage({ kind: 'request', id, method, params })
}

// Bootstrap: learn the origin's grant state before the page has called
// anything, so the port opens at document_start when already granted.
void sendReadOnly(ZNN_IS_GRANTED).then((response) => reconcilePort(response.granted))

function isInpageRequest(data: unknown): data is InpageRequestMessage {
  const d = data as Partial<InpageRequestMessage> | undefined
  return !!d && d.target === TARGET_CONTENT_SCRIPT && typeof d.id === 'string' && typeof d.method === 'string'
}

window.addEventListener('message', (event: MessageEvent) => {
  // Both ends of the postMessage bridge must filter on event.source — a
  // cross-origin iframe could otherwise raise a request attributed to this
  // frame's origin (§6.3, edge case 20).
  if (event.source !== window) return
  if (!isInpageRequest(event.data)) return

  const { id, method, params } = event.data

  if (READ_ONLY_METHODS.has(method)) {
    void sendReadOnly(method as ReadOnlyRequest['method']).then((response) => {
      // Re-evaluated on every relayed message, including read-only ones —
      // the router already answered a permission check on this path, so the
      // port opens here if the grant has appeared since load (§6.4).
      reconcilePort(response.granted)
      replyToPage(id, response.result, response.error)
    })
    return
  }

  sendPrompting(id, method, params)
})

// Stop reconnecting once the tab is actually going away.
window.addEventListener('pagehide', () => {
  closedByUs = true
  port?.disconnect()
  port = null
})

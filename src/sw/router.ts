import {
  accountBlockProblem,
  ERR_INVALID_PARAMS,
  ERR_NOT_CONNECTED,
  ERR_TOO_MANY_REQUESTS,
  ERR_UNKNOWN_METHOD,
  ERR_WALLET_UNAVAILABLE,
  INTERNAL_MESSAGE_CHANNEL,
  PROVIDER_MESSAGE_CHANNEL,
  PROVIDER_PORT_NAME,
  sendTransactionParamsProblem,
  ZNN_ACCOUNTS,
  ZNN_CHAIN_ID,
  ZNN_CONNECT,
  ZNN_DISCONNECT,
  ZNN_IS_GRANTED,
  ZNN_NODE_URL,
  ZNN_SEND_TRANSACTION,
  ZNN_SIGN,
  ZNN_SIGN_AND_SEND_BLOCK,
  type ApprovalsSettleMessage,
  type InboxEntry,
  type PortMessageToWorker,
  type PortRequestMessage,
  type PortResyncMessage,
  type PortsDisconnectMessage,
  type PromptingMethod,
  type ReadOnlyRequest,
  type ReadOnlyResponse,
} from '@/core/inpage-protocol'
import { messageProblem } from '@/core/message-guard'
import { grant, isGranted, revoke, touch } from '@/core/site-permissions'
import { getActiveAccountAddress, getChainId, getNodeUrl, hasAnyWallet } from './public-state'
import { disconnectAllPorts, disconnectPortsForOrigin, registerPort } from './ports'
import {
  addToInbox,
  findInboxEntry,
  isTracked,
  openOrFocusApprovalWindow,
  redeliverTo,
  settle,
} from './approval-inbox'

/**
 * Channel routing, permission checks, and answers for both the read-only
 * one-shot channel (§6.3, §6.4) and the prompting port channel, plus the
 * approval window's internal settle notification (§6.5). Registered
 * synchronously at module top level — background.ts imports this module for
 * its side effect — so any message wakes a terminated worker.
 */

const PROMPTING_METHODS: readonly PromptingMethod[] = [
  ZNN_CONNECT,
  ZNN_SIGN,
  ZNN_SEND_TRANSACTION,
  ZNN_SIGN_AND_SEND_BLOCK,
]

// --- Read-only, one-shot channel (§6.3, §6.4) ---

function isReadOnlyRequest(message: unknown): message is ReadOnlyRequest {
  const m = message as Partial<ReadOnlyRequest> | undefined
  return !!m && m.channel === PROVIDER_MESSAGE_CHANNEL && typeof m.method === 'string'
}

async function handleReadOnlyRequest(
  message: ReadOnlyRequest,
  sender: chrome.runtime.MessageSender
): Promise<ReadOnlyResponse> {
  const origin = sender.origin
  if (!origin) {
    return { granted: false, error: { code: ERR_NOT_CONNECTED, message: 'No sender origin.' } }
  }

  const granted = await isGranted(origin)

  switch (message.method) {
    case ZNN_IS_GRANTED:
      return { granted }

    case ZNN_ACCOUNTS: {
      if (!granted) return { granted, result: [] }
      void touch(origin)
      const address = await getActiveAccountAddress()
      return { granted, result: address ? [address] : [] }
    }

    // Chain id and node url are public, non-sensitive data — answered
    // regardless of grant, matching desktop's znn_info (§2.1) and unlike
    // znn_accounts, which identifies the user to the site.
    case ZNN_CHAIN_ID:
      return { granted, result: await getChainId() }

    case ZNN_NODE_URL:
      return { granted, result: await getNodeUrl() }

    case ZNN_DISCONNECT:
      if (granted) await revoke(origin)
      return { granted: false }

    default:
      return {
        granted,
        error: { code: ERR_UNKNOWN_METHOD, message: `Unknown method '${message.method as string}'.` },
      }
  }
}

// --- Prompting, port channel (§6.4) ---

function isPromptingMethod(method: string): method is PromptingMethod {
  return (PROMPTING_METHODS as readonly string[]).includes(method)
}

function validateParams(method: PromptingMethod, params: unknown): string | null {
  switch (method) {
    case ZNN_CONNECT:
      return null
    case ZNN_SIGN:
      return messageProblem(params)
    case ZNN_SEND_TRANSACTION:
      return sendTransactionParamsProblem(params)
    case ZNN_SIGN_AND_SEND_BLOCK:
      return accountBlockProblem(params)
  }
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

async function handlePortRequest(port: chrome.runtime.Port, message: PortRequestMessage): Promise<void> {
  const sender = port.sender
  const origin = sender?.origin
  const tabId = sender?.tab?.id
  const frameId = sender?.frameId
  const { id, method, params } = message

  // Can't attribute this request to a frame at all; nothing safe to do.
  if (!origin || tabId === undefined || frameId === undefined) return

  // Idempotent by id: a request whose id is already tracked creates nothing
  // and replies accepted again — without this a lost `accepted` would turn
  // one re-sent request into two dialogs (§6.4).
  if (await isTracked(id)) {
    port.postMessage({ kind: 'accepted', id })
    return
  }

  if (!isPromptingMethod(method)) {
    port.postMessage({ kind: 'outcome', id, error: { code: ERR_UNKNOWN_METHOD, message: `Unknown method '${method}'.` } })
    return
  }

  // znn_connect is exempt from the not-granted rule — it arrives from an
  // ungranted origin by definition, so without this exemption the surface
  // could never bootstrap (§6.4).
  if (method !== ZNN_CONNECT && !(await isGranted(origin))) {
    port.postMessage({ kind: 'outcome', id, error: { code: ERR_NOT_CONNECTED, message: 'Origin is not connected.' } })
    return
  }

  if (!(await hasAnyWallet())) {
    port.postMessage({ kind: 'outcome', id, error: { code: ERR_WALLET_UNAVAILABLE, message: 'No wallet exists.' } })
    return
  }

  // Validated in the worker, before any window opens — a malformed request
  // never becomes a dialog (§6.4).
  const problem = validateParams(method, params)
  if (problem) {
    port.postMessage({ kind: 'outcome', id, error: { code: ERR_INVALID_PARAMS, message: problem } })
    return
  }

  const tab = sender.tab
  const entry: InboxEntry = {
    id,
    origin,
    tabId,
    frameId,
    topFrameHost: frameId !== 0 ? hostOf(tab?.url) : undefined,
    title: tab?.title,
    favicon: tab?.favIconUrl,
    method,
    params,
    createdAt: Date.now(),
  }

  const added = await addToInbox(entry)
  if (!added) {
    port.postMessage({ kind: 'outcome', id, error: { code: ERR_TOO_MANY_REQUESTS, message: 'Too many pending requests.' } })
    return
  }

  // Write before reply: the inbox write above is awaited before `accepted`
  // goes out, so a resync racing the accept can never see this id as
  // unknown while it is about to become a live dialog (§6.4). Getting this
  // order wrong is the worst failure in the design — the page could give up
  // on an id the user then approves, publishing against an abandoned request.
  port.postMessage({ kind: 'accepted', id })
  await openOrFocusApprovalWindow()
}

async function handlePortResync(port: chrome.runtime.Port, message: PortResyncMessage): Promise<void> {
  const sender = port.sender
  const tabId = sender?.tab?.id
  const frameId = sender?.frameId
  if (tabId === undefined || frameId === undefined) return

  const unknown: string[] = []
  const trackedIds: string[] = []
  for (const id of message.ids) {
    if (await isTracked(id)) trackedIds.push(id)
    else unknown.push(id)
  }

  // Ids still pending in the inbox are tracked but have no outcome yet —
  // redeliverTo() is a no-op for those, which is correct: the user is still
  // deciding, and nothing more is required (§6.4).
  if (trackedIds.length > 0) await redeliverTo(tabId, frameId, trackedIds)
  port.postMessage({ kind: 'resyncResult', unknown })
}

// --- The approval window's internal settle channel (§6.5) ---

function isApprovalsSettleMessage(message: unknown): message is ApprovalsSettleMessage {
  const m = message as Partial<ApprovalsSettleMessage> | undefined
  return !!m && m.channel === INTERNAL_MESSAGE_CHANNEL && m.kind === 'approvals.settle' && typeof m.id === 'string'
}

/**
 * A content script's `sender.url` is the page it's injected into; only our
 * own extension pages (the approval window) have a chrome-extension:// url.
 * Without this check, a page's content script could forge an
 * {channel:'internal'} message and settle someone else's pending request
 * with an attacker-chosen result — the Syrius extension's own router gates
 * its internal channel the same way.
 */
function isFromOwnExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''))
}

async function handleApprovalsSettle(message: ApprovalsSettleMessage): Promise<void> {
  const entry = await findInboxEntry(message.id)
  if (!entry) return // already settled (e.g. a window-close race) — no-op

  if (entry.method === ZNN_CONNECT && !message.error) {
    // Grant before delivering the outcome, so the port stays open under its
    // granted-origin condition once the request completes (§6.5).
    await grant(entry.origin, { title: entry.title, favicon: entry.favicon })
  }

  await settle(entry.id, entry.tabId, entry.frameId, { result: message.result, error: message.error })
}

// --- useConnectedSites.ts's internal port-teardown request (§6.7) ---

function isPortsDisconnectMessage(message: unknown): message is PortsDisconnectMessage {
  const m = message as Partial<PortsDisconnectMessage> | undefined
  return !!m && m.channel === INTERNAL_MESSAGE_CHANNEL && m.kind === 'ports.disconnect'
}

// --- Listener registration ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isReadOnlyRequest(message)) {
    void handleReadOnlyRequest(message, sender).then(sendResponse)
    return true
  }

  if (!isFromOwnExtensionPage(sender)) return false

  if (isApprovalsSettleMessage(message)) {
    void handleApprovalsSettle(message).then(() => sendResponse({ ok: true }))
    return true
  }

  if (isPortsDisconnectMessage(message)) {
    if (message.origin) disconnectPortsForOrigin(message.origin)
    else disconnectAllPorts()
    sendResponse({ ok: true })
    return true
  }

  return false
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PROVIDER_PORT_NAME) return
  registerPort(port)

  port.onMessage.addListener((message: PortMessageToWorker) => {
    if (message.kind === 'request') void handlePortRequest(port, message)
    else if (message.kind === 'resync') void handlePortResync(port, message)
  })
})

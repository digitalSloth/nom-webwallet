import {
  accountBlockProblem,
  addressProblem,
  sendTransactionParamsProblem,
  tokenStandardProblem,
} from './account-block-validation'

/**
 * Shared vocabulary between the service worker and every page context
 * (content script, inpage script, approval window). Zero SDK imports, so it
 * is safe to import from the service worker. Provider-only — phases 1 and 2
 * never import this file, and the web bundle never sees these names.
 */

export { accountBlockProblem, addressProblem, sendTransactionParamsProblem, tokenStandardProblem }

// --- postMessage bridge targets (inpage.ts ↔ content-script.ts, §6.3) ---
export const TARGET_CONTENT_SCRIPT = 'znn-contentscript'
export const TARGET_INPAGE = 'znn-inpage'

/** Name of the chrome.runtime.Port content-script.ts opens to the worker. */
export const PROVIDER_PORT_NAME = 'znn-provider'

/** `message.channel` for the one-shot read-only request/response below. */
export const PROVIDER_MESSAGE_CHANNEL = 'znn-provider'

// --- Wire method names (§6.1) ---
// Read-only, one-shot chrome.runtime.sendMessage (phase 3a).
export const ZNN_ACCOUNTS = 'znn_accounts'
export const ZNN_CHAIN_ID = 'znn_chainId'
export const ZNN_NODE_URL = 'znn_nodeUrl'
export const ZNN_DISCONNECT = 'znn_disconnect'
// Prompting, chrome.runtime.Port (phase 3b). Named now so the whole wire
// contract is one vocabulary; not reachable until window.zenon exposes them.
export const ZNN_CONNECT = 'znn_connect'
export const ZNN_SIGN = 'znn_sign'
export const ZNN_SEND_TRANSACTION = 'znn_sendTransaction'
export const ZNN_SIGN_AND_SEND_BLOCK = 'znn_signAndSendBlock'

export type ReadOnlyMethod =
  | typeof ZNN_ACCOUNTS
  | typeof ZNN_CHAIN_ID
  | typeof ZNN_NODE_URL
  | typeof ZNN_DISCONNECT

export type PromptingMethod =
  | typeof ZNN_CONNECT
  | typeof ZNN_SIGN
  | typeof ZNN_SEND_TRANSACTION
  | typeof ZNN_SIGN_AND_SEND_BLOCK

/**
 * Content-script-internal check, never exposed on `window.zenon`. Lets the
 * content script learn its origin's grant state at `document_start` — before
 * the page has called anything — so it can decide whether to open its port
 * (§6.4: "opened at document_start if the origin is already granted").
 */
export const ZNN_IS_GRANTED = 'znn_isGranted'

// --- EIP-1193 error codes (§6.2) ---
export const ERR_USER_REJECTED = 4001
export const ERR_NOT_CONNECTED = 4100
export const ERR_UNKNOWN_METHOD = 4200
export const ERR_WALLET_UNAVAILABLE = 4900
export const ERR_INVALID_PARAMS = -32602
export const ERR_TRANSPORT_OR_SEND_FAILED = -32603
export const ERR_TOO_MANY_REQUESTS = -32005

export interface ProviderError {
  code: number
  message: string
}

// --- One-shot read-only channel (page → content script → SW → content script → page) ---

/** content-script.ts → src/sw/router.ts, over chrome.runtime.sendMessage. */
export interface ReadOnlyRequest {
  channel: typeof PROVIDER_MESSAGE_CHANNEL
  method: ReadOnlyMethod | typeof ZNN_IS_GRANTED
}

/** src/sw/router.ts → content-script.ts, in the sendResponse callback. */
export interface ReadOnlyResponse {
  granted: boolean
  result?: unknown
  error?: ProviderError
}

// --- Port channel (page → content script → SW, long-lived) ---

export type PortMessageKind = 'request' | 'accepted' | 'outcome' | 'resync' | 'resyncResult' | 'event'

export type ProviderEventName = 'accountsChanged' | 'chainChanged' | 'nodeChanged'

/** SW → content script → page, fanned out to every port of a granted origin (§6.8). */
export interface PortEventMessage {
  kind: 'event'
  name: ProviderEventName
  data: unknown
}

/** content-script.ts → SW: a prompting call, id minted by the content script. */
export interface PortRequestMessage {
  kind: 'request'
  id: string
  method: PromptingMethod
  params: unknown
}

/** content-script.ts → SW, on reconnect, for every still-outstanding request id. */
export interface PortResyncMessage {
  kind: 'resync'
  ids: string[]
}

/** SW → content-script.ts: the request id is now durably tracked (inbox or outcome store). */
export interface PortAcceptedMessage {
  kind: 'accepted'
  id: string
}

/** SW → content-script.ts, delivered to exactly one port (§6.4) — never fanned out. */
export interface PortOutcomeMessage {
  kind: 'outcome'
  id: string
  result?: unknown
  error?: ProviderError
}

/** SW → content-script.ts, reply to `resync`. An id is `unknown` only if it is in neither the inbox nor the outcome store. */
export interface PortResyncResultMessage {
  kind: 'resyncResult'
  unknown: string[]
}

export type PortMessageToWorker = PortRequestMessage | PortResyncMessage
export type PortMessageFromWorker =
  | PortAcceptedMessage
  | PortOutcomeMessage
  | PortResyncResultMessage
  | PortEventMessage

// --- The service-worker inbox (§6.5) ---

export interface InboxEntry {
  id: string // `ip:${uuid}`, minted by the content script (§6.4)
  origin: string // the requesting frame's origin, from port.sender.origin
  tabId: number // from port.sender.tab.id — the outcome's destination
  frameId: number // from port.sender.frameId
  topFrameHost?: string // host of port.sender.tab.url; set only when frameId !== 0
  title?: string
  favicon?: string
  method: PromptingMethod
  params: unknown // already validated
  createdAt: number
  windowId?: number // stamped when a window is shown the entry
}

// --- The internal settle channel (approval window → SW, chrome.runtime.sendMessage) ---

/** `message.channel` for the approval window's settle notification. */
export const INTERNAL_MESSAGE_CHANNEL = 'internal'

export interface ApprovalsSettleMessage {
  channel: typeof INTERNAL_MESSAGE_CHANNEL
  kind: 'approvals.settle'
  id: string
  result?: unknown
  error?: ProviderError
}

/**
 * useConnectedSites.ts → SW: a revoke initiated from the settings dialog,
 * not the dApp's own tab. Storage is already updated by the caller (any
 * extension context can write chrome.storage.local); this asks the worker
 * to also disconnect the live port(s), which only it can see (§6.4, §6.7).
 * Omit `origin` to disconnect every open port (revoke all).
 */
export interface PortsDisconnectMessage {
  channel: typeof INTERNAL_MESSAGE_CHANNEL
  kind: 'ports.disconnect'
  origin?: string
}

// --- window.postMessage bridge shapes (inpage.ts ↔ content-script.ts) ---

/** inpage.ts → content-script.ts, for a read-only or prompting call. */
export interface InpageRequestMessage {
  target: typeof TARGET_CONTENT_SCRIPT
  id: string
  method: ReadOnlyMethod | PromptingMethod
  params?: unknown
}

/** content-script.ts → inpage.ts, settling a pending call. */
export interface InpageResponseMessage {
  target: typeof TARGET_INPAGE
  id: string
  result?: unknown
  error?: ProviderError
}

/** content-script.ts → inpage.ts, forwarding a fanned-out event. */
export interface InpageEventMessage {
  target: typeof TARGET_INPAGE
  kind: 'event'
  name: ProviderEventName
  data: unknown
}

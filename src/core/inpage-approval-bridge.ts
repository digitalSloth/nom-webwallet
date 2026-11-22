import { Address } from 'znn-typescript-sdk'
import { Buffer } from 'buffer'
import { SESSION_KEY_PENDING_REQUESTS } from '@/config'
import { createSerialQueue } from './serial-queue'
import { listInbox } from '@/sw/approval-inbox'
import {
  InvalidParamsError,
  parseAccountBlockJson,
  parseSendTransactionParams,
} from './account-block-params'
import {
  dropApprovals,
  enqueueApproval,
  type ApprovalAction,
  type ApprovalHandlers,
  type ApprovalResult,
  type PendingApproval,
  type WalletRejection,
} from './dapp-approvals'
import {
  ERR_INVALID_PARAMS,
  ERR_NOT_CONNECTED,
  ERR_TOO_MANY_REQUESTS,
  ERR_TRANSPORT_OR_SEND_FAILED,
  ERR_UNKNOWN_METHOD,
  ERR_USER_REJECTED,
  ERR_WALLET_UNAVAILABLE,
  INTERNAL_MESSAGE_CHANNEL,
  SIDE_PANEL_PORT_NAME,
  ZNN_CONNECT,
  ZNN_REQUEST_MESSAGE_ACCESS,
  ZNN_SEND_ENCRYPTED_MESSAGE,
  ZNN_SEND_TRANSACTION,
  ZNN_SIGN,
  ZNN_SIGN_AND_SEND_BLOCK,
  type ApprovalsRebindMessage,
  type ApprovalsSettleMessage,
  type InboxEntry,
  type ProviderError,
} from './inpage-protocol'
import {
  encryptedMessageParamsProblem,
  encryptedMessageRequest,
  envelopeLength,
} from './message-envelope'
import { ownPanelToken } from './panel-token'

/**
 * Converts service-worker inbox entries into the shared approval queue
 * (dapp-approvals.ts) that an ApprovalHost renders (§6.5). Page-only. Two
 * hosts run it: the approval window (ApproveApp.vue) claims the entries
 * stamped with its window, and the side panel (approval/panel-approvals.ts)
 * claims the entries the worker bound to its browser window. Reaches into
 * sw/approval-inbox.ts for a plain storage read; that module otherwise
 * requires chrome.windows, which is fine here too (both hosts are full
 * trusted extension pages, not content scripts — unlike phase 3a's
 * inpage.ts/content-script.ts, nothing here is subject to a visited page's
 * CSP, so there is no reason to avoid the shared chunk).
 */

/** Where the bridge runs: the approval window, or the side panel of one browser window. */
export type InboxBridgeHost = { kind: 'window' } | { kind: 'panel'; windowId: number }

const processed = new Set<string>()

function postSettle(id: string, payload: { result?: unknown; error?: ProviderError }): void {
  const message: ApprovalsSettleMessage = {
    channel: INTERNAL_MESSAGE_CHANNEL,
    kind: 'approvals.settle',
    id,
    ...payload,
  }
  void chrome.runtime.sendMessage(message)
}

async function postRebind(id: string, account: string): Promise<boolean> {
  const message: ApprovalsRebindMessage = {
    channel: INTERNAL_MESSAGE_CHANNEL,
    kind: 'approvals.rebind',
    id,
    account,
  }
  const response: unknown = await chrome.runtime.sendMessage(message)
  return (response as { ok?: unknown } | undefined)?.ok === true
}

function toOutgoingError(rejection: WalletRejection): ProviderError {
  switch (rejection.reason) {
    case 'userRejected':
      return { code: ERR_USER_REJECTED, message: 'User rejected the request.' }
    case 'walletLocked':
      return { code: ERR_WALLET_UNAVAILABLE, message: 'Wallet is locked.' }
    case 'invalidParams':
      return { code: ERR_INVALID_PARAMS, message: rejection.detail }
    case 'notConnected':
      return { code: ERR_NOT_CONNECTED, message: 'Origin is not connected.' }
    case 'unsupportedMethod':
      return { code: ERR_UNKNOWN_METHOD, message: 'Unsupported method.' }
    case 'sendFailed':
      return { code: ERR_TRANSPORT_OR_SEND_FAILED, message: rejection.detail }
    case 'tooManyRequests':
      return { code: ERR_TOO_MANY_REQUESTS, message: 'Too many pending requests.' }
    case 'accountChanged':
      return {
        code: ERR_TRANSPORT_OR_SEND_FAILED,
        message: 'The active account or chain changed after this request was made.',
      }
  }
}

/** §6.1: sendTransaction returns a bare hash; sendAccountBlock returns the block JSON. */
function toProviderResult(method: InboxEntry['method'], result: ApprovalResult): unknown {
  switch (result.kind) {
    case 'connect':
    case 'messageAccess':
      return result.address
    case 'signMessage':
      return {
        message: result.message,
        address: result.address,
        publicKey: result.publicKey,
        signature: result.signature,
      }
    case 'sendBlock':
      return method === ZNN_SEND_TRANSACTION ? result.block.hash.toString() : result.block.toJson()
  }
}

/**
 * Re-validates the params and checks that the public key is the one of the
 * recipient address, so the screen can never show one recipient while the
 * message is encrypted to another key. Address.fromPublicKey only yields user
 * addresses, so an embedded contract is refused by the same check.
 */
function parseEncryptedMessage(params: unknown): ApprovalAction {
  const problem = encryptedMessageParamsProblem(params)
  if (problem) throw new InvalidParamsError(problem)
  const { to, publicKey, content } = encryptedMessageRequest(params)
  if (Address.fromPublicKey(Buffer.from(publicKey, 'hex')).toString() !== to) {
    throw new InvalidParamsError('The public key does not belong to the recipient.')
  }
  return {
    kind: 'sendMessage',
    to,
    recipientPublicKey: publicKey,
    content,
    envelopeBytes: envelopeLength(content),
  }
}

function buildAction(entry: InboxEntry): ApprovalAction {
  switch (entry.method) {
    case ZNN_CONNECT:
      return { kind: 'connect' }
    case ZNN_REQUEST_MESSAGE_ACCESS:
      return { kind: 'messageAccess' }
    case ZNN_SEND_ENCRYPTED_MESSAGE:
      return parseEncryptedMessage(entry.params)
    case ZNN_SIGN:
      return { kind: 'signMessage', message: entry.params as string }
    case ZNN_SEND_TRANSACTION:
      return { kind: 'sendBlock', block: parseSendTransactionParams(entry.params, entry.chainId) }
    case ZNN_SIGN_AND_SEND_BLOCK:
      return { kind: 'sendBlock', block: parseAccountBlockJson(entry.params, entry.chainId) }
  }
}

function claim(entry: InboxEntry): void {
  if (processed.has(entry.id)) return
  processed.add(entry.id)

  let action: ApprovalAction
  try {
    action = buildAction(entry)
  } catch (err) {
    // Not expected — the worker ran the same validators over the same JSON
    // (§1.2) — but handled as a real error path: the entry settles with no
    // dialog rendered, rather than assumed away (§6.5).
    const message = err instanceof InvalidParamsError ? err.message : 'Invalid request.'
    postSettle(entry.id, { error: { code: ERR_INVALID_PARAMS, message } })
    return
  }

  const approval: PendingApproval = {
    id: entry.id,
    surface: 'inpage',
    origin: entry.origin,
    topFrameHost: entry.topFrameHost,
    peer: {
      name: entry.title ?? entry.origin,
      url: entry.origin,
      icons: entry.favicon ? [entry.favicon] : [],
    },
    createdAt: entry.createdAt,
    account: entry.account,
    chainId: entry.chainId,
    action,
  }

  const handlers: ApprovalHandlers = {
    resolve: async (result) => {
      postSettle(entry.id, { result: toProviderResult(entry.method, result) })
    },
    reject: async (reason) => {
      postSettle(entry.id, { error: toOutgoingError(reason) })
    },
    ...(entry.method === ZNN_CONNECT
      ? { rebind: (account: string) => postRebind(entry.id, account) }
      : {}),
  }

  // The shared queue enforces its own MAX_PENDING_DAPP_REQUESTS cap. The
  // worker's inbox cap already keeps this from being reachable in practice,
  // since both queues share the same limit (§1.4).
  const enqueued = enqueueApproval(approval, handlers)
  if (!enqueued) {
    postSettle(entry.id, {
      error: { code: ERR_TOO_MANY_REQUESTS, message: 'Too many pending requests.' },
    })
  }
}

let panelPort: chrome.runtime.Port | null = null

// The worker finds the panel through this port and rejects the panel's
// entries when it disconnects, so the panel holds it for its whole lifetime
// and posts its window id first. A dropped port (the worker stopped) queues
// a run that reconnects. This side never calls disconnect(): only the panel
// closing may end it.
function ensurePanelPort(windowId: number, queueRun: () => void): void {
  if (panelPort) return
  const opened = chrome.runtime.connect({ name: SIDE_PANEL_PORT_NAME })
  opened.onDisconnect.addListener(() => {
    if (panelPort === opened) panelPort = null
    queueRun()
  })
  panelPort = opened
  // A hidden panel stays unregistered: the visibility watcher posts the
  // hello when the document becomes visible.
  const token = ownPanelToken()
  const hidden = typeof document !== 'undefined' && document.visibilityState !== 'visible'
  if (token !== undefined && !hidden) opened.postMessage({ windowId, token })
  if (!visibilityWatched && typeof document !== 'undefined') {
    visibilityWatched = true
    watchPanelVisibility(document, () => panelPort, windowId)
  }
}

let visibilityWatched = false

/**
 * Re-sends the hello on the live port whenever `doc` becomes visible. The
 * worker drops a panel's record when Chrome hides it for another panel, and
 * the same document keeps its port when it is shown again.
 */
export function watchPanelVisibility(
  doc: {
    visibilityState: DocumentVisibilityState
    addEventListener: (type: 'visibilitychange', listener: () => void) => void
  },
  getPort: () => Pick<chrome.runtime.Port, 'postMessage'> | null,
  windowId: number
): void {
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return
    const token = ownPanelToken()
    const port = getPort()
    if (token === undefined || port === null) return
    try {
      port.postMessage({ windowId, token })
    } catch {
      // A port that closed under us reconnects through its disconnect handler.
    }
  })
}

// No node connection here: connect and signMessage never need one, and a
// send connects when the user approves it (TransactionService).
async function claimAll(host: InboxBridgeHost, queueRun: () => void): Promise<void> {
  if (host.kind === 'panel') ensurePanelPort(host.windowId, queueRun)
  const current = host.kind === 'window' ? (await chrome.windows.getCurrent()).id : host.windowId
  const inbox = await listInbox()
  const bound = inbox.filter((entry) =>
    host.kind === 'window' ? entry.windowId === current : entry.panelWindowId === current
  )
  const boundIds = new Set(bound.map((entry) => entry.id))

  // An entry the worker rejected or settled must leave the screen: it can no
  // longer be approved.
  dropApprovals((a) => a.surface === 'inpage' && !boundIds.has(a.id))

  for (const entry of bound) claim(entry)
}

/** Starts draining the inbox entries bound to `host` into the shared approval queue. Call once per document. */
export function startInboxBridge(host: InboxBridgeHost): void {
  // One run at a time, so a run never works from an older inbox read than
  // the run before it.
  const serial = createSerialQueue()
  const run = (): void => {
    serial(() => claimAll(host, run)).catch((err: unknown) =>
      console.error('Failed to read the approval inbox', err)
    )
  }
  run()

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && SESSION_KEY_PENDING_REQUESTS in changes) run()
  })
}

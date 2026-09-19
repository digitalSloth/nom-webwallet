import { SESSION_KEY_PENDING_REQUESTS } from '@/config'
import { listInbox } from '@/sw/approval-inbox'
import { ZenonService } from './zenon-service'
import { InvalidParamsError, parseAccountBlockJson, parseSendTransactionParams } from './account-block-params'
import {
  enqueueApproval,
  type ApprovalAction,
  type ApprovalHandlers,
  type ApprovalResult,
  type PendingApproval,
  type WalletRejection,
} from './dapp-approvals'
import {
  ERR_INVALID_PARAMS,
  ERR_TOO_MANY_REQUESTS,
  INTERNAL_MESSAGE_CHANNEL,
  ZNN_CONNECT,
  ZNN_SEND_TRANSACTION,
  ZNN_SIGN,
  ZNN_SIGN_AND_SEND_BLOCK,
  type ApprovalsSettleMessage,
  type InboxEntry,
  type ProviderError,
} from './inpage-protocol'

/**
 * Converts service-worker inbox entries into the shared approval queue
 * (dapp-approvals.ts) that DappApprovalDialog.vue already renders (§6.5).
 * Page-only — started once by ApproveApp.vue on mount. Reaches into
 * sw/approval-inbox.ts for a plain storage read; that module otherwise
 * requires chrome.windows, which is fine here too (the approval window is a
 * full trusted extension page, not a content script — unlike phase 3a's
 * inpage.ts/content-script.ts, nothing here is subject to a visited page's
 * CSP, so there is no reason to avoid the shared chunk).
 */

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

function toOutgoingError(rejection: WalletRejection): ProviderError {
  switch (rejection.reason) {
    case 'userRejected':
      return { code: 4001, message: 'User rejected the request.' }
    case 'walletLocked':
      return { code: 4900, message: 'Wallet is locked.' }
    case 'invalidParams':
      return { code: ERR_INVALID_PARAMS, message: rejection.detail }
    case 'notConnected':
      return { code: 4100, message: 'Origin is not connected.' }
    case 'unsupportedMethod':
      return { code: 4200, message: 'Unsupported method.' }
    case 'sendFailed':
      return { code: -32603, message: rejection.detail }
    case 'tooManyRequests':
      return { code: ERR_TOO_MANY_REQUESTS, message: 'Too many pending requests.' }
  }
}

/** §6.1: sendTransaction returns a bare hash; sendAccountBlock returns the block JSON. */
function toProviderResult(method: InboxEntry['method'], result: ApprovalResult): unknown {
  switch (result.kind) {
    case 'connect':
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

function buildAction(entry: InboxEntry): ApprovalAction {
  switch (entry.method) {
    case ZNN_CONNECT:
      return { kind: 'connect' }
    case ZNN_SIGN:
      return { kind: 'signMessage', message: entry.params as string }
    case ZNN_SEND_TRANSACTION:
      return { kind: 'sendBlock', block: parseSendTransactionParams(entry.params) }
    case ZNN_SIGN_AND_SEND_BLOCK:
      return { kind: 'sendBlock', block: parseAccountBlockJson(entry.params) }
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
    action,
  }

  const handlers: ApprovalHandlers = {
    resolve: async (result) => {
      postSettle(entry.id, { result: toProviderResult(entry.method, result) })
    },
    reject: async (reason) => {
      postSettle(entry.id, { error: toOutgoingError(reason) })
    },
  }

  // The shared queue enforces its own MAX_PENDING_DAPP_REQUESTS cap. The
  // worker's inbox cap already keeps this from being reachable in practice,
  // since both queues share the same limit (§1.4).
  const enqueued = enqueueApproval(approval, handlers)
  if (!enqueued) {
    postSettle(entry.id, { error: { code: ERR_TOO_MANY_REQUESTS, message: 'Too many pending requests.' } })
  }
}

async function claimAll(): Promise<void> {
  await ZenonService.getInstance().ensureInitialized()
  const current = (await chrome.windows.getCurrent()).id
  const inbox = await listInbox()
  for (const entry of inbox) {
    if (entry.windowId === current) claim(entry)
  }
}

/** Starts draining the inbox into the shared approval queue. Idempotent — safe to call once. */
export function startInboxBridge(): void {
  void claimAll()

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && SESSION_KEY_PENDING_REQUESTS in changes) {
      void claimAll()
    }
  })
}

import { computed, shallowRef } from 'vue'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { MAX_PENDING_DAPP_REQUESTS } from '@/config'
import type { MessageContent } from './message-envelope'

/**
 * The page-side approval queue: the type vocabulary shared by both dApp
 * surfaces, and the FIFO queue that backs the approval screens (the web
 * dialog and the extension windows). Follows
 * `pow-status.ts` — a module-level ref inside `src/core`, not a composable —
 * because the module is page-only (it names `AccountBlockTemplate`) and every
 * consumer needs the same reactive view regardless of who enqueues.
 */

export type ApprovalSurface = 'walletconnect' | 'inpage'

export type ApprovalAction =
  | { kind: 'connect' }
  | { kind: 'messageAccess' }
  | {
      kind: 'sendMessage'
      to: string
      recipientPublicKey: string
      content: MessageContent
      envelopeBytes: number
    }
  | { kind: 'signMessage'; message: string }
  | { kind: 'sendBlock'; block: AccountBlockTemplate }

/** WalletConnect Verify API result for the peer's claimed domain. */
export type PeerVerification = 'valid' | 'invalid' | 'unknown'

export interface PendingApproval {
  id: string // `wc:${topic}:${rpcId}` or `ip:${uuid}`
  surface: ApprovalSurface
  origin: string // WC peer url, or the requesting frame's origin
  topFrameHost?: string // set for a subframe request
  peer: { name: string; url: string; icons: string[] }
  createdAt: number
  expiresAt?: number
  // The active account and chain when the request arrived. Approving re-reads
  // both from storage and refuses if either has changed since, so the dialog,
  // the dApp's view and the signing key always agree.
  account: string
  chainId: number
  verification?: PeerVerification // WalletConnect only
  action: ApprovalAction
}

export interface ApprovalHandlers {
  resolve(result: ApprovalResult): Promise<void>
  reject(reason: WalletRejection): Promise<void>
  /** In-page connect only: re-binds the worker's inbox entry. Resolves false when refused. */
  rebind?(account: string): Promise<boolean>
}

export type ApprovalResult =
  | { kind: 'connect'; address: string }
  | { kind: 'messageAccess'; address: string }
  | { kind: 'signMessage'; message: string; address: string; publicKey: string; signature: string }
  | { kind: 'sendBlock'; block: AccountBlockTemplate }

/** Surface-neutral failure reasons. Each surface maps these to its own codes. */
export type WalletRejection =
  | { reason: 'userRejected' }
  | { reason: 'walletLocked' }
  | { reason: 'invalidParams'; detail: string }
  | { reason: 'notConnected' }
  | { reason: 'unsupportedMethod' }
  | { reason: 'sendFailed'; detail: string }
  | { reason: 'tooManyRequests' }
  | { reason: 'accountChanged' }

// shallowRef, not ref: a sendBlock action carries an AccountBlockTemplate, and
// a deep ref would proxy it, causing re-render churn during PoW and handing a
// Proxy back to the dApp on resolve. The array itself stays reactive because
// every mutation below replaces queue.value with a new array.
const queue = shallowRef<PendingApproval[]>([])
const handlers = new Map<string, ApprovalHandlers>()

/** Read-only reactive view for useDappApprovals. */
export const approvalQueue = computed(() => queue.value)

// Requests that left the head since the queue was last empty. With the queue
// length it gives a stable "i of N" across a run of requests.
const handled = shallowRef(0)

/** Read-only count of requests handled since the queue was last empty. */
export const handledSinceEmpty = computed(() => handled.value)

function replaceQueue(next: PendingApproval[]): void {
  const head = queue.value[0]
  const headLeft = head !== undefined && !next.some((a) => a.id === head.id)
  queue.value = next
  handled.value = next.length === 0 ? 0 : handled.value + (headLeft ? 1 : 0)
}

function prune(): void {
  const now = Date.now()
  const expired = queue.value.filter((a) => a.expiresAt !== undefined && a.expiresAt <= now)
  if (expired.length === 0) return

  for (const approval of expired) {
    handlers.delete(approval.id)
  }
  replaceQueue(queue.value.filter((a) => a.expiresAt === undefined || a.expiresAt > now))
}

export function enqueueApproval(a: PendingApproval, h: ApprovalHandlers): boolean {
  prune()
  if (queue.value.length >= MAX_PENDING_DAPP_REQUESTS) return false

  queue.value = [...queue.value, a]
  handlers.set(a.id, h)
  return true
}

export function dequeueApproval(id: string): void {
  replaceQueue(queue.value.filter((a) => a.id !== id))
  handlers.delete(id)
}

/** Drops every matching approval without settling it, e.g. when its WalletConnect session ends. */
export function dropApprovals(match: (a: PendingApproval) => boolean): void {
  for (const approval of queue.value) {
    if (match(approval)) handlers.delete(approval.id)
  }
  replaceQueue(queue.value.filter((a) => !match(a)))
}

/** Replaces a pending connect's bound account. Returns false for any other entry. */
export function rebindApproval(id: string, account: string): boolean {
  const entry = queue.value.find((a) => a.id === id)
  if (!entry || entry.action.kind !== 'connect') return false
  replaceQueue(queue.value.map((a) => (a.id === id ? { ...a, account } : a)))
  return true
}

export function listApprovals(): PendingApproval[] {
  prune()
  return queue.value
}

export function getHandlers(id: string): ApprovalHandlers | undefined {
  return handlers.get(id)
}

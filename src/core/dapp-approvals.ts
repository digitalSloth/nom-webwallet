import { computed, shallowRef } from 'vue'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { MAX_PENDING_DAPP_REQUESTS } from '@/config'

/**
 * The page-side approval queue: the type vocabulary shared by both dApp
 * surfaces, and the FIFO queue that backs the one dialog component. Follows
 * `pow-status.ts` — a module-level ref inside `src/core`, not a composable —
 * because the module is page-only (it names `AccountBlockTemplate`) and every
 * consumer needs the same reactive view regardless of who enqueues.
 */

export type ApprovalSurface = 'walletconnect' | 'inpage'

export type ApprovalAction =
  | { kind: 'connect' }
  | { kind: 'signMessage'; message: string }
  | { kind: 'sendBlock'; block: AccountBlockTemplate }

export interface PendingApproval {
  id: string // `wc:${topic}:${rpcId}` or `ip:${uuid}`
  surface: ApprovalSurface
  origin: string // WC peer url, or the requesting frame's origin
  topFrameHost?: string // set for a subframe request
  peer: { name: string; url: string; icons: string[] }
  createdAt: number
  expiresAt?: number
  action: ApprovalAction
}

export interface ApprovalHandlers {
  resolve(result: ApprovalResult): Promise<void>
  reject(reason: WalletRejection): Promise<void>
}

export type ApprovalResult =
  | { kind: 'connect'; address: string }
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

// shallowRef, not ref: a sendBlock action carries an AccountBlockTemplate, and
// a deep ref would proxy it, causing re-render churn during PoW and handing a
// Proxy back to the dApp on resolve. The array itself stays reactive because
// every mutation below replaces queue.value with a new array.
const queue = shallowRef<PendingApproval[]>([])
const handlers = new Map<string, ApprovalHandlers>()

/** Read-only reactive view for useDappApprovals. */
export const approvalQueue = computed(() => queue.value)

function prune(): void {
  const now = Date.now()
  const expired = queue.value.filter((a) => a.expiresAt !== undefined && a.expiresAt <= now)
  if (expired.length === 0) return

  for (const approval of expired) {
    handlers.delete(approval.id)
  }
  queue.value = queue.value.filter((a) => a.expiresAt === undefined || a.expiresAt > now)
}

export function enqueueApproval(a: PendingApproval, h: ApprovalHandlers): boolean {
  prune()
  if (queue.value.length >= MAX_PENDING_DAPP_REQUESTS) return false

  queue.value = [...queue.value, a]
  handlers.set(a.id, h)
  return true
}

export function dequeueApproval(id: string): void {
  queue.value = queue.value.filter((a) => a.id !== id)
  handlers.delete(id)
}

export function listApprovals(): PendingApproval[] {
  prune()
  return queue.value
}

export function getHandlers(id: string): ApprovalHandlers | undefined {
  return handlers.get(id)
}

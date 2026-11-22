import type { TrackedEntry, TrackedTx, TxStage } from '@/core'

const DONE_VISIBLE_MS = 5_000

export type TxKind = 'transfer' | 'contract' | 'receive'

export interface TxProgress {
  /** Timeline steps complete. */
  reached: 0 | 1 | 2 | 3
  /** nom-ui TxStatus `status`. */
  status: 'pending' | 'confirming' | 'success' | 'failed'
  /** nom-ui TxStatus `label`. */
  label: string
  /** One-line description. */
  text: string
  momentum: number | null
  banner: 'failed' | 'stale' | 'rejected' | null
}

export function txKind(tx: TrackedTx): TxKind {
  if (tx.meta?.kind === 'receive') return 'receive'
  if (tx.meta?.kind === 'contract') return 'contract'
  return 'transfer'
}

function n(momentum: number): string {
  return momentum.toLocaleString('en-US')
}

/** The banner text for a send the node refused. */
export function rejectedBanner(reason: string): string {
  return `The node rejected the transaction: ${reason.replace(/\.+$/, '')}. Nothing was sent.`
}

export function txProgress(stage: TxStage, kind: TxKind): TxProgress {
  switch (stage.kind) {
    case 'published':
      return {
        reached: 1,
        status: 'pending',
        label: 'Published',
        text: 'Published, waiting for the network',
        momentum: null,
        banner: null,
      }
    case 'confirmed':
      return {
        reached: 2,
        status: 'confirming',
        label: 'Confirming',
        text: `Confirmed in momentum ${n(stage.momentum)}, waiting for the contract`,
        momentum: stage.momentum,
        banner: null,
      }
    case 'awaitingRecipient':
      return {
        reached: 2,
        status: 'success',
        label: 'Confirmed',
        text: `Confirmed in momentum ${n(stage.momentum)}, waiting for the recipient`,
        momentum: stage.momentum,
        banner: null,
      }
    case 'received':
      return {
        reached: 3,
        status: 'success',
        label: 'Received',
        text:
          kind === 'receive'
            ? `Received in momentum ${n(stage.momentum)}`
            : 'Received by the recipient',
        momentum: stage.momentum,
        banner: null,
      }
    case 'executed': {
      const k = stage.pendingFollowOns
      if (k === 0) {
        return {
          reached: 3,
          status: 'success',
          label: 'Executed',
          text: 'Contract executed',
          momentum: null,
          banner: null,
        }
      }
      const noun = k === 1 ? '1 follow-on block' : `${k} follow-on blocks`
      return {
        reached: 2,
        status: 'confirming',
        label: 'Confirming',
        text: `Executed, waiting for ${noun}`,
        momentum: null,
        banner: null,
      }
    }
    case 'failed':
      return {
        reached: 2,
        status: 'failed',
        label: 'Failed',
        text: `Confirmed in momentum ${n(stage.momentum)}, but the contract call failed`,
        momentum: stage.momentum,
        banner: 'failed',
      }
    case 'timedOut':
      return {
        reached: 1,
        status: 'pending',
        label: 'Still waiting',
        text: 'Still waiting after several minutes. Check the explorer.',
        momentum: null,
        banner: 'stale',
      }
    case 'rejected':
      return {
        reached: 0,
        status: 'failed',
        label: 'Not sent',
        text: `Not published, rejected by ${stage.node}`,
        momentum: null,
        banner: 'rejected',
      }
  }
}

/**
 * The entry the toast shows: the first of `entries` (newest publish first)
 * sent from `address`, not rejected, and either still tracking or finished
 * at most 5 s before `now`. Null when `address` is null or nothing matches.
 */
export function toastEntry(
  entries: readonly TrackedEntry[],
  address: string | null,
  now: number
): TrackedEntry | null {
  if (address === null) return null
  return (
    entries.find(
      (e) =>
        e.tx.address === address &&
        e.stage.kind !== 'rejected' &&
        (!e.done || now - e.updatedAt <= DONE_VISIBLE_MS)
    ) ?? null
  )
}

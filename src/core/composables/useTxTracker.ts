import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import { useToast } from 'nom-ui'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { getSendRecorder } from '../send-recorder'
import type { TxMeta } from '../send-recorder'
import { storageService } from '../storage/storage-service'
import { TransactionService } from '../transaction-service'
import { createTxTracker, describeStage } from '../tx-tracker'
import type { TrackedTx, TxStage } from '../tx-tracker'

const SUCCESS_TOAST_MS = 10_000
const ATTENTION_TOAST_MS = 15_000

const listeners = new Set<(tx: TrackedTx) => void>()

let options = { toasts: true, followRecipient: false }

/**
 * Chooses whether stage changes raise toasts and whether a user send is
 * followed until the recipient receives it. Runs before the tracker is first
 * created.
 */
export function configureTxTracker(next: { toasts: boolean; followRecipient: boolean }): void {
  options = { ...next }
}

export interface TrackedEntry {
  tx: TrackedTx
  stage: TxStage
  /** True once tracking of the transaction has ended. */
  done: boolean
  updatedAt: number
}

// Replaced with a new Map on every change.
const entries = shallowRef(new Map<string, TrackedEntry>())

function setEntry(entry: TrackedEntry): void {
  const next = new Map(entries.value)
  next.set(entry.tx.hash, entry)
  entries.value = next
}

function markDone(tx: TrackedTx): void {
  const current = entries.value.get(tx.hash)
  if (!current) return
  setEntry({ ...current, done: true, updatedAt: Date.now() })
}

/** The transactions this document tracks, newest publish first. */
export function useTrackedTransactions(): {
  entries: ComputedRef<TrackedEntry[]>
  get(hash: string): TrackedEntry | null
} {
  return {
    entries: computed(() =>
      [...entries.value.values()].sort((a, b) => b.tx.publishedAt - a.tx.publishedAt)
    ),
    get: (hash) => entries.value.get(hash) ?? null,
  }
}

function showToast(tx: TrackedTx, stage: TxStage): void {
  const { toast } = useToast()
  const { text, tone } = describeStage(tx.label, stage)
  const id = `tx-${tx.hash}`
  if (tone === 'loading') {
    toast.loading(text, { id })
  } else {
    // vue-sonner reads `duration` only at mount, so a final state needs a new id.
    toast.dismiss(id)
    toast[tone](text, {
      id: `${id}-done`,
      duration: tone === 'success' ? SUCCESS_TOAST_MS : ATTENTION_TOAST_MS,
    })
  }
}

function notify(tx: TrackedTx, stage: TxStage): void {
  setEntry({ tx, stage, done: false, updatedAt: Date.now() })
  if (options.toasts) showToast(tx, stage)
  if (stage.kind === 'published' || stage.kind === 'timedOut') return
  listeners.forEach((listener) => listener(tx))
}

let tracker: ReturnType<typeof createTxTracker> | null = null

function getTracker(): ReturnType<typeof createTxTracker> {
  if (!tracker) {
    tracker = createTxTracker({
      getBlock: (hash) => TransactionService.getInstance().getAccountBlock(hash),
      storage: storageService,
      notify,
      followRecipient: options.followRecipient,
      stopped: markDone,
    })
  }
  return tracker
}

/**
 * Follows a published transaction, then releases its send record. Never
 * rejects: a failure here must not turn an already published block into a
 * failed send.
 */
export async function trackPublished(tx: TrackedTx): Promise<void> {
  try {
    await getTracker().track(tx)
  } catch (err) {
    console.warn('Could not track transaction', err)
  }
  try {
    await getSendRecorder().release(tx.hash)
  } catch (err) {
    console.warn('Could not release send record', err)
  }
}

/** Follow a published block. Never throws. */
export function trackTransaction(
  label: string,
  block: AccountBlockTemplate,
  meta?: TxMeta
): Promise<void> {
  try {
    return trackPublished({
      hash: block.hash.toString(),
      label,
      address: block.address.toString(),
      publishedAt: Date.now(),
      ...(meta ? { meta } : {}),
    })
  } catch (err) {
    console.warn('Could not track transaction', err)
    return Promise.resolve()
  }
}

/** Adds an in-memory entry for a send the node refused. Returns its local id. */
export function trackRejected(input: {
  label: string
  address: string
  meta?: TxMeta
  reason: string
  node: string
}): string {
  const id = `rejected-${crypto.randomUUID()}`
  const now = Date.now()
  setEntry({
    tx: {
      hash: id,
      label: input.label,
      address: input.address,
      publishedAt: now,
      ...(input.meta ? { meta: input.meta } : {}),
    },
    stage: { kind: 'rejected', reason: input.reason, node: input.node },
    done: true,
    updatedAt: now,
  })
  return id
}

/** Resume tracking the transactions stored by an earlier session. */
export function resumeTracking(): Promise<void> {
  return getTracker().resume()
}

/** Call `listener` on every tracked stage after publish. Returns an unsubscribe function. */
export function onTxProgress(listener: (tx: TrackedTx) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

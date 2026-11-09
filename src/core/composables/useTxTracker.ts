import {useToast} from 'nom-ui'
import type {AccountBlockTemplate} from 'znn-typescript-sdk'
import {storageService} from '../storage/storage-service'
import {TransactionService} from '../transaction-service'
import {createTxTracker, describeStage} from '../tx-tracker'
import type {TrackedTx, TxStage} from '../tx-tracker'

const SUCCESS_TOAST_MS = 10_000
const ATTENTION_TOAST_MS = 15_000

const listeners = new Set<(tx: TrackedTx) => void>()

function notify(tx: TrackedTx, stage: TxStage): void {
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
    })
  }
  return tracker
}

/**
 * Follow a published block with one live toast. Never throws: a failure here
 * must not turn an already published block into a failed send.
 */
export function trackTransaction(label: string, block: AccountBlockTemplate): void {
  try {
    getTracker().track({
      hash: block.hash.toString(),
      label,
      address: block.address.toString(),
      publishedAt: Date.now(),
    })
  } catch (err) {
    console.warn('Could not track transaction', err)
  }
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

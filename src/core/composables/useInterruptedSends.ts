import { computed, shallowRef } from 'vue'
import type { ComputedRef } from 'vue'
import type { Router } from 'vue-router'
import { SEND_HEARTBEAT_MS } from '@/config'
import type { TxMeta } from '../send-recorder'
import { classify } from '../send-record'
import type { InterruptedRecord, InterruptedSource, SendRecord } from '../send-record'
import { trackPublished } from './useTxTracker'

// Interrupted sends waiting for the user, oldest first.
const pending = shallowRef<InterruptedRecord[]>([])

// Where interrupted records are read from. Each app sets it once at startup.
let source: InterruptedSource = {
  list: () => Promise.resolve([]),
  remove: () => Promise.resolve(),
  take: () => Promise.resolve(false),
}

export function configureInterruptedSends(next: InterruptedSource): void {
  source = next
}

function withoutFrom(context: SendRecord['context']): TxMeta {
  return Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'from')) as TxMeta
}

export function useInterruptedSends(): {
  current: ComputedRef<InterruptedRecord | null>
  dismiss(id: string): Promise<void>
  /** Takes a record for a retry: true only for the one caller that deletes it. */
  claim(record: SendRecord): Promise<boolean>
  retryTarget(record: SendRecord, activeAddress: string | null): 'send-review' | 'receive' | null
} {
  async function dismiss(id: string): Promise<void> {
    pending.value = pending.value.filter((record) => record.id !== id)
    await source.remove(id)
  }

  async function claim(record: SendRecord): Promise<boolean> {
    pending.value = pending.value.filter((r) => r.id !== record.id)
    return source.take(record.id, record.stage)
  }

  function retryTarget(
    record: SendRecord,
    activeAddress: string | null
  ): 'send-review' | 'receive' | null {
    const { context } = record
    if (
      record.detached ||
      context.origin ||
      context.kind === 'contract' ||
      context.from !== activeAddress
    )
      return null
    if (context.kind === 'receive') return 'receive'
    const complete =
      context.amount !== undefined &&
      context.decimals !== undefined &&
      context.symbol !== undefined &&
      context.tokenStandard !== undefined &&
      context.recipient !== undefined
    return complete ? 'send-review' : null
  }

  return { current: computed(() => pending.value[0] ?? null), dismiss, claim, retryTarget }
}

/**
 * Finds sends whose document closed mid-way. Published ones go to the
 * tracker. The rest wait in `pending`, and the interrupted screen opens when
 * the user is on Home.
 */
export async function checkInterrupted(
  router: Router,
  options: { popupStart: boolean }
): Promise<void> {
  const records = await source.list(Date.now(), {
    popupStart: options.popupStart,
    keep: new Set(pending.value.map((record) => record.id)),
  })

  const unresolved: InterruptedRecord[] = []
  for (const record of records) {
    const action = classify(record)
    if (action.kind === 'track') {
      await trackPublished({
        hash: action.hash,
        label: record.context.title,
        address: record.context.from,
        publishedAt: record.publishedAt ?? record.heartbeatAt,
        meta: withoutFrom(record.context),
      })
    } else if (record.context.background === true) {
      // An auto-receive moves no funds out and the node refuses a second receive.
      source.remove(record.id).catch((err) => console.warn('Could not remove send record', err))
    } else {
      unresolved.push(record)
    }
  }
  pending.value = unresolved

  if (unresolved.length === 0) return
  const name = router.currentRoute.value.name
  if (name === 'interrupted') return
  if (name === 'home') await router.replace({ name: 'interrupted' })
}

/** Runs the check now and every SEND_HEARTBEAT_MS. Returns a function that stops it. */
export function startInterruptedChecks(
  router: Router,
  options: { popupStart: boolean }
): () => void {
  let running = false

  async function run(popupStart: boolean): Promise<void> {
    if (running) return
    running = true
    try {
      await checkInterrupted(router, { popupStart })
    } catch (err) {
      console.warn('Interrupted send check failed', err)
    } finally {
      running = false
    }
  }

  void run(options.popupStart)
  const timer = setInterval(() => void run(false), SEND_HEARTBEAT_MS)
  return () => clearInterval(timer)
}

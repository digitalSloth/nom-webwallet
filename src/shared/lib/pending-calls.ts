import { shallowRef } from 'vue'
import { useTrackedTransactions } from '@/core/composables/useTxTracker'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'

type Pending = 'running' | 'unknown' | { hash: string }

// Replaced with a new Map on every change. Lives as long as the tab.
const pending = shallowRef(new Map<string, Pending>())

function change(update: (next: Map<string, Pending>) => void): void {
  const next = new Map(pending.value)
  update(next)
  pending.value = next
}

/** True while a call under `key` runs, or its transaction is not yet done. */
export function isPending(key: string): boolean {
  const value = pending.value.get(key)
  if (value === undefined) return false
  if (value === 'running' || value === 'unknown') return true
  const entry = useTrackedTransactions().get(value.hash)
  return entry === null || !entry.done
}

/** Marks `key` running. False when `key` is already pending: the caller must not send. */
export function claimPending(key: string): boolean {
  if (isPending(key)) return false
  change((next) => next.set(key, 'running'))
  return true
}

/**
 * Ends the running state of `key`. A hash keeps it pending until the tracker
 * entry for that hash is done; 'unknown' keeps it pending for the life of the
 * tab; 'none' releases it.
 */
export function settlePending(key: string, outcome: { hash: string } | 'unknown' | 'none'): void {
  change((next) => {
    if (outcome === 'none') next.delete(key)
    else next.set(key, outcome)
  })
}

/**
 * claimPending, then `run`, then settlePending with the block's hash. On a
 * throw it settles 'unknown' when the message is SEND_TIMEOUT_MESSAGE, else
 * 'none', and rethrows. Resolves null without running when `key` is pending.
 */
export async function runPending<T extends { hash: { toString(): string } }>(
  key: string,
  run: () => Promise<T>
): Promise<T | null> {
  if (!claimPending(key)) return null
  try {
    const block = await run()
    settlePending(key, { hash: block.hash.toString() })
    return block
  } catch (err) {
    settlePending(
      key,
      err instanceof Error && err.message === SEND_TIMEOUT_MESSAGE ? 'unknown' : 'none'
    )
    throw err
  }
}

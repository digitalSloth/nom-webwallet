import type { TxMeta, usePillar } from '@/core'
import { runPending } from '@/shared/lib/pending-calls'

type DelegateToPillar = ReturnType<typeof usePillar>['delegateToPillar']

/** Per-tab guard key shared by delegate and undelegate. */
export function delegationKey(address: string | null): string {
  return `delegation:${address}`
}

export function delegateMeta(name: string): TxMeta {
  return {
    kind: 'contract',
    title: `Pillars · Delegate to ${name}`,
    progress: `Delegating to ${name}`,
  }
}

/** One delegate block. Resolves null when a delegation call for `from` is already pending. */
export function sendDelegation(
  delegateToPillar: DelegateToPillar,
  wallet: Parameters<DelegateToPillar>[0],
  from: string,
  name: string
): Promise<Awaited<ReturnType<DelegateToPillar>> | null> {
  return runPending(delegationKey(from), () =>
    delegateToPillar(wallet, from, name, false, delegateMeta(name))
  )
}

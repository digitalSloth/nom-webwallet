import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import type { useWallet } from '@/core'
import type { TxMeta } from '@/core'
import { trackRejected } from '@/core/composables/useTxTracker'
import { PublishRejectedError, SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import type { Wallet } from '@/types'
import { runPending } from '@/shared/lib/pending-calls'

export type ActionResult =
  | { kind: 'sent'; hash: string }
  | { kind: 'skipped' } // locked wallet, or key already pending
  | { kind: 'error'; message: string; timeout: boolean }

/**
 * Runs one embedded-contract send under a pending key. Checks the lock
 * state and the active account first, and turns every failure into a result.
 */
export async function runContractAction(input: {
  key: string
  from: string
  wallet: Pick<
    ReturnType<typeof useWallet>,
    'refreshLockState' | 'activeWallet' | 'isActiveWalletUnlocked' | 'activeAccountAddress'
  >
  meta: TxMeta
  node: string
  send: (wallet: Wallet) => Promise<AccountBlockTemplate>
}): Promise<ActionResult> {
  const { key, from, wallet, meta, node, send } = input
  wallet.refreshLockState()
  const activeWallet = wallet.activeWallet.value
  if (activeWallet === null || !wallet.isActiveWalletUnlocked.value) return { kind: 'skipped' }
  if (wallet.activeAccountAddress.value !== from) {
    return {
      kind: 'error',
      message: 'The active account changed. Review this again from the current account.',
      timeout: false,
    }
  }
  try {
    const block = await runPending(key, () => send(activeWallet))
    if (!block) return { kind: 'skipped' }
    return { kind: 'sent', hash: block.hash.toString() }
  } catch (err) {
    if (err instanceof PublishRejectedError) {
      trackRejected({ label: meta.title, address: from, meta, reason: err.reason, node })
      return {
        kind: 'error',
        message: `The node refused this transaction. Nothing was sent: ${err.reason}`,
        timeout: false,
      }
    }
    const message =
      err instanceof Error && err.message ? err.message : 'Failed to send the transaction'
    return { kind: 'error', message, timeout: message === SEND_TIMEOUT_MESSAGE }
  }
}

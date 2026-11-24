import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import type { Wallet } from '@/types'
import { sessionManager } from './session-manager'
import { TransactionService } from './transaction-service'
import { runActivity } from './composables/useActivity'
import { trackTransaction } from './composables/useTxTracker'
import { assertNoUnresolvedCall } from './contract-guard'
import type { TxMeta } from './send-recorder'

/**
 * Signs and publishes an embedded-contract call from `from`. Errors
 * propagate unchanged, and the block is never logged. A guarded token call
 * is refused while a stored send record of the same call exists.
 */
export async function sendContractCall(input: {
  wallet: Wallet
  from: string
  block: AccountBlockTemplate
  meta: TxMeta
  activity: string
}): Promise<AccountBlockTemplate> {
  const { wallet, from, block, meta, activity } = input
  const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
  if (!keyStore) {
    throw new Error('Wallet is locked. Please unlock it first.')
  }
  const account = wallet.accounts.find((acc) => acc.address === from)
  if (!account) {
    throw new Error('Account not found')
  }
  const keyPair = keyStore.getKeyPair(account.index)
  const call = await assertNoUnresolvedCall(block, from)
  return await runActivity(activity, async () => {
    const sent = await TransactionService.getInstance().sendEmbeddedContractBlock(
      block,
      keyPair,
      undefined,
      { ...meta, from, ...(call ? { call } : {}) }
    )
    void trackTransaction(meta.title, sent, meta)
    return sent
  })
}

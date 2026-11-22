import {ref} from 'vue'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'
import type {TxMeta} from '../send-recorder'
import type {Wallet} from '@/types'
import type {AccountBlockTemplate} from 'znn-typescript-sdk'

// Module-level reactive state — shared across every useTransaction() caller
const isSending = ref(false)
const isReceiving = ref(false)
const error = ref<string | null>(null)

export function useTransaction() {
  const transactionService = TransactionService.getInstance()

  // Send transaction
  async function sendTransaction(
    wallet: Wallet,
    accountAddress: string,
    recipient: string,
    tokenStandard: string,
    amount: bigint,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
    isSending.value = true
    error.value = null

    try {
      // Get keyStore
      const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
      if (!keyStore) {
        throw new Error('Wallet is locked. Please unlock it first.')
      }

      // Find account
      const account = wallet.accounts.find((acc) => acc.address === accountAddress)
      if (!account) {
        throw new Error('Account not found')
      }

      // Get keypair
      const keyPair = keyStore.getKeyPair(account.index)

      // Send transaction
      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Sending transaction', async () => {
        const block = await transactionService.sendTransaction(
          recipient,
          tokenStandard,
          amount,
          keyPair,
          context
        )
        void trackTransaction(meta?.title ?? 'Send', block, meta)
        return block
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to send transaction'
      throw err
    } finally {
      isSending.value = false
    }
  }

  // Receive transaction
  async function receiveTransaction(
    wallet: Wallet,
    accountAddress: string,
    blockHash: string,
    meta?: TxMeta,
    beforePublish?: () => unknown
  ): Promise<AccountBlockTemplate> {
    isReceiving.value = true
    error.value = null

    try {
      // Get keyStore
      const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
      if (!keyStore) {
        throw new Error('Wallet is locked. Please unlock it first.')
      }

      // Find account
      const account = wallet.accounts.find((acc) => acc.address === accountAddress)
      if (!account) {
        throw new Error('Account not found')
      }

      // Get keypair
      const keyPair = keyStore.getKeyPair(account.index)

      // Receive transaction
      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Receiving transaction', async () => {
        const block = await transactionService.receiveTransaction(
          blockHash,
          keyPair,
          context,
          beforePublish
        )
        void trackTransaction(meta?.title ?? 'Receive', block, meta)
        return block
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to receive transaction'
      throw err
    } finally {
      isReceiving.value = false
    }
  }

  return {
    // State
    isSending,
    isReceiving,
    error,

    // Methods
    sendTransaction,
    receiveTransaction,
  }
}

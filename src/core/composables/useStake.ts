import {ref} from 'vue'
import {StakeService} from '../stake-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'
import type {AccountBlockTemplate, StakeEntry} from 'znn-typescript-sdk'
import type {TxMeta} from '../send-recorder'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every useStake() caller
const stakeEntries = ref<StakeEntry[]>([])
const isLoading = ref(false)
const isStaking = ref(false)
const isCanceling = ref(false)
const cancelingStakeId = ref<string | null>(null)
const error = ref<string | null>(null)
const stakeEntriesFor = ref<string | null>(null)
let latestLoad = 0

export function useStake() {
  const stakeService = StakeService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load stake entries for an address
  async function loadStakeEntries(address: string, pageIndex: number = 0, pageSize: number = 25) {
    const load = ++latestLoad
    if (!address) {
      stakeEntries.value = []
      stakeEntriesFor.value = null
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await stakeService.getStakeEntries(address, pageIndex, pageSize)
      // A newer load owns the list; an older response must not overwrite it.
      if (load !== latestLoad) return
      stakeEntries.value = result.list || []
      stakeEntriesFor.value = address
    } catch (err) {
      if (load !== latestLoad) return
      error.value = err instanceof Error ? err.message : 'Failed to load stake entries'
      console.error('Failed to load stake entries:', err)
      stakeEntries.value = []
      stakeEntriesFor.value = null
    } finally {
      if (load === latestLoad) isLoading.value = false
    }
  }

  // Stake ZNN
  async function stakeZnn(
    wallet: Wallet,
    accountAddress: string,
    durationInSec: number,
    amount: bigint,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
    isStaking.value = true
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

      // Create stake block
      const block = stakeService.createStakeBlock(durationInSec, amount)

      // Send transaction
      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Staking ZNN', async () => {
        const sent = await transactionService.sendEmbeddedContractBlock(
          block,
          keyPair,
          undefined,
          context
        )
        void trackTransaction(meta?.title ?? 'Stake ZNN', sent, meta)
        return sent
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to stake ZNN'
      throw err
    } finally {
      isStaking.value = false
    }
  }

  // Cancel a stake
  async function cancelStake(
    wallet: Wallet,
    accountAddress: string,
    stakeId: string,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
    isCanceling.value = true
    cancelingStakeId.value = stakeId
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

      // Create cancel block
      const block = stakeService.createCancelStakeBlock(stakeId)

      // Send transaction
      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Cancelling stake', async () => {
        const sent = await transactionService.sendEmbeddedContractBlock(
          block,
          keyPair,
          undefined,
          context
        )
        void trackTransaction(meta?.title ?? 'Cancel stake', sent, meta)
        return sent
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to cancel stake'
      throw err
    } finally {
      isCanceling.value = false
      cancelingStakeId.value = null
    }
  }

  return {
    // State
    stakeEntries,
    isLoading,
    isStaking,
    isCanceling,
    cancelingStakeId,
    error,
    stakeEntriesFor,

    // Methods
    loadStakeEntries,
    stakeZnn,
    cancelStake,
  }
}

import {ref} from 'vue'
import {StakeService} from '../stake-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import type {StakeEntry} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every useStake() caller
const stakeEntries = ref<StakeEntry[]>([])
const isLoading = ref(false)
const isStaking = ref(false)
const isCanceling = ref(false)
const cancelingStakeId = ref<string | null>(null)
const error = ref<string | null>(null)

export function useStake() {
  const stakeService = StakeService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load stake entries for an address
  async function loadStakeEntries(address: string, pageIndex: number = 0, pageSize: number = 25) {
    if (!address) {
      stakeEntries.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await stakeService.getStakeEntries(address, pageIndex, pageSize)
      stakeEntries.value = result.list || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load stake entries'
      console.error('Failed to load stake entries:', err)
      stakeEntries.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Stake ZNN
  async function stakeZnn(
    wallet: Wallet,
    accountAddress: string,
    durationInSec: number,
    amount: bigint
  ): Promise<void> {
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
      await transactionService.sendEmbeddedContractBlock(block, keyPair)
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
    stakeId: string
  ): Promise<void> {
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
      await transactionService.sendEmbeddedContractBlock(block, keyPair)
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

    // Methods
    loadStakeEntries,
    stakeZnn,
    cancelStake,
  }
}

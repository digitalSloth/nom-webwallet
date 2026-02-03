import {ref} from 'vue'
import type {RewardInfo, RewardType} from '../rewards-service'
import {RewardsService} from '../rewards-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every useRewards() caller
const rewards = ref<RewardInfo[]>([])
const isLoading = ref(false)
const isCollecting = ref(false)
const collectingType = ref<RewardType | null>(null)
const error = ref<string | null>(null)

export function useRewards() {
  const rewardsService = RewardsService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load all uncollected rewards for an address
  async function loadRewards(address: string | null) {
    if (!address) {
      rewards.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      rewards.value = await rewardsService.getAllUncollectedRewards(address)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load rewards'
      console.error('Failed to load rewards:', err)
      rewards.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Collect rewards of a given type for an account
  async function collectReward(
    wallet: Wallet,
    accountAddress: string,
    type: RewardType
  ): Promise<void> {
    isCollecting.value = true
    collectingType.value = type
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

      // Create collect block and send
      const block = rewardsService.createCollectRewardBlock(type)
      await transactionService.sendEmbeddedContractBlock(block, keyPair)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to collect reward'
      throw err
    } finally {
      isCollecting.value = false
      collectingType.value = null
    }
  }

  return {
    // State
    rewards,
    isLoading,
    isCollecting,
    collectingType,
    error,

    // Methods
    loadRewards,
    collectReward,
  }
}

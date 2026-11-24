import {ref} from 'vue'
import type {AccountBlockTemplate} from 'znn-typescript-sdk'
import type {RewardEpoch, RewardInfo, RewardType} from '../rewards-service'
import {REWARD_SOURCE_LABELS, REWARD_TYPES, RewardsService} from '../rewards-service'
import type {TxMeta} from '../send-recorder'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'
import type {Wallet} from '@/types'

export interface CollectAllResult {
  collected: { type: RewardType; hash: string }[]
  failed: { type: RewardType; message: string } | null
}

/** Sources with a non-zero ZNN or QSR amount, in REWARD_TYPES order. */
export function collectableSources(rewards: readonly RewardInfo[]): RewardType[] {
  return REWARD_TYPES.filter((type) =>
    rewards.some(
      (r) => r.type === type && (BigInt(r.reward.znnAmount) > 0n || BigInt(r.reward.qsrAmount) > 0n)
    )
  )
}

/** Tracker and PoW-dialog text for collecting `type`. */
export function collectMeta(type: RewardType, progress: string): TxMeta {
  return {
    kind: 'contract',
    title: `Rewards · Collect ${REWARD_SOURCE_LABELS[type].toLowerCase()} rewards`,
    progress,
  }
}

// Module-level reactive state — shared across every useRewards() caller
const rewards = ref<RewardInfo[]>([])
const rewardsFor = ref<string | null>(null)
const isLoading = ref(false)
const isCollecting = ref(false)
const collectingType = ref<RewardType | null>(null)
const error = ref<string | null>(null)
const history = ref<RewardEpoch[]>([])
const historyFor = ref<string | null>(null)
const historyError = ref<string | null>(null)
const isLoadingHistory = ref(false)
const genesisAt = ref<number | null>(null)
let latestRewardsLoad = 0
let latestHistoryLoad = 0

export function useRewards() {
  const rewardsService = RewardsService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load all uncollected rewards for an address
  async function loadRewards(address: string | null) {
    const load = ++latestRewardsLoad
    if (!address) {
      rewards.value = []
      rewardsFor.value = null
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await rewardsService.getAllUncollectedRewards(address)
      // A newer load owns the list; an older response must not overwrite it.
      if (load !== latestRewardsLoad) return
      rewards.value = result
      rewardsFor.value = address
    } catch (err) {
      if (load !== latestRewardsLoad) return
      error.value = err instanceof Error ? err.message : 'Failed to load rewards'
      console.error('Failed to load rewards:', err)
      rewards.value = []
      rewardsFor.value = null
    } finally {
      if (load === latestRewardsLoad) isLoading.value = false
    }
  }

  // Load the reward history and the genesis time that dates its epochs
  async function loadHistory(address: string) {
    const load = ++latestHistoryLoad
    isLoadingHistory.value = true
    historyError.value = null

    const [historyResult, genesisResult] = await Promise.allSettled([
      rewardsService.getRewardHistory(address),
      rewardsService.getGenesisTime(),
    ])
    if (load !== latestHistoryLoad) return

    if (historyResult.status === 'fulfilled') {
      history.value = historyResult.value
      historyFor.value = address
    } else {
      history.value = []
      historyFor.value = null
      historyError.value = "Couldn't load reward history from the node."
      console.error('Failed to load reward history:', historyResult.reason)
    }
    genesisAt.value = genesisResult.status === 'fulfilled' ? genesisResult.value : null
    isLoadingHistory.value = false
  }

  // Collect rewards of a given type for an account
  async function collectReward(
    wallet: Wallet,
    accountAddress: string,
    type: RewardType,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
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
      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity(`Collecting ${type} rewards`, async () => {
        const sent = await transactionService.sendEmbeddedContractBlock(
          block,
          keyPair,
          undefined,
          context
        )
        void trackTransaction(meta?.title ?? `Collect ${type} rewards`, sent, meta)
        return sent
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to collect reward'
      throw err
    } finally {
      isCollecting.value = false
      collectingType.value = null
    }
  }

  // Collect several sources one after another; stops at the first failure
  async function collectAll(
    wallet: Wallet,
    accountAddress: string,
    types: readonly RewardType[]
  ): Promise<CollectAllResult> {
    const ordered = REWARD_TYPES.filter((t) => types.includes(t))
    const collected: CollectAllResult['collected'] = []
    for (const [i, type] of ordered.entries()) {
      try {
        const block = await collectReward(
          wallet,
          accountAddress,
          type,
          collectMeta(type, `Collecting ${i + 1} of ${ordered.length}`)
        )
        collected.push({ type, hash: block.hash.toString() })
      } catch (err) {
        const message =
          err instanceof Error && err.message ? err.message : 'Failed to collect reward'
        return { collected, failed: { type, message } }
      }
    }
    return { collected, failed: null }
  }

  return {
    // State
    rewards,
    rewardsFor,
    isLoading,
    isCollecting,
    collectingType,
    error,
    history,
    historyFor,
    historyError,
    isLoadingHistory,
    genesisAt,

    // Methods
    loadRewards,
    loadHistory,
    collectReward,
    collectAll,
  }
}

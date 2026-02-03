import {ref} from 'vue'
import {PillarService} from '../pillar-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import type {PillarInfo} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'

// Constants for APR calculation
const DAILY_ZNN_REWARDS = 4320
const DAYS_PER_YEAR = 360 // 12 months * 30 days
const YEARLY_ZNN_REWARDS = DAILY_ZNN_REWARDS * DAYS_PER_YEAR // 1,555,200 (not 1,576,800)
const DELEGATE_REWARD_SHARE = 0.24 // 24% of total rewards goes to delegates
const MOMENTUM_REWARD_SHARE = 0.5 // 50% of total rewards goes to momentum producers
const MOMENTUMS_PER_DAY = 8640
const DECIMALS = 100000000 // 8 decimals for ZNN

export interface PillarWithApr extends PillarInfo {
  delegateApr: number
}

// Module-level reactive state — shared across every usePillar() caller
const pillars = ref<PillarWithApr[]>([])
const isLoading = ref(false)
const isDelegating = ref(false)
const error = ref<string | null>(null)

export function usePillar() {
  const pillarService = PillarService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Calculate delegate APR for all pillars
  function calculatePillarAPRs(pillarList: PillarInfo[], totalPillarCount: number): PillarWithApr[] {
    if (pillarList.length === 0) return []

    const top30Count = Math.min(30, totalPillarCount)
    const notTop30Count = Math.max(0, totalPillarCount - 30)

    // Calculate total delegated ZNN from pillar weights
    let totalDelegatedZnn = BigInt(0)
    for (const pillar of pillarList) {
      totalDelegatedZnn += BigInt(pillar.weight.toString())
    }

    if (totalDelegatedZnn === BigInt(0)) {
      return pillarList.map(p => ({ ...p, delegateApr: 0 } as PillarWithApr))
    }

    // Calculate momentum distribution
    const secondaryGroupSize = Math.max(1, totalPillarCount - 15)
    const halfDayMomentums = MOMENTUMS_PER_DAY * 0.5

    // Total expected daily momentums for each group
    const totalExpectedDailyMomentumsTop30 = halfDayMomentums + (halfDayMomentums * 15 / secondaryGroupSize)
    const totalExpectedDailyMomentumsNotTop30 = halfDayMomentums * (secondaryGroupSize - 15) / secondaryGroupSize

    // Yearly reward pools
    const yearlyDelegateRewardPool = YEARLY_ZNN_REWARDS * DELEGATE_REWARD_SHARE // 373,248 ZNN
    const yearlyMomentumRewardPool = YEARLY_ZNN_REWARDS * MOMENTUM_REWARD_SHARE // 777,600 ZNN

    // Yearly momentum rewards for top 30 vs not top 30
    const yearlyMomentumRewardsTop30 = yearlyMomentumRewardPool * (totalExpectedDailyMomentumsTop30 / MOMENTUMS_PER_DAY)
    const yearlyMomentumRewardsNotTop30 = yearlyMomentumRewardPool * (totalExpectedDailyMomentumsNotTop30 / MOMENTUMS_PER_DAY)

    return pillarList.map(pillar => {
      const weight = BigInt(pillar.weight.toString())

      if (weight === BigInt(0)) {
        return { ...pillar, delegateApr: 0 } as PillarWithApr
      }

      const isTop30 = pillar.rank < 30
      const { producedMomentums, expectedMomentums } = pillar.currentStats

      // Calculate reward multiplier based on momentum performance
      const rewardMultiplier = (expectedMomentums - producedMomentums > 2 && expectedMomentums > 0)
        ? producedMomentums / expectedMomentums
        : 1

      // Calculate momentum rewards for this pillar
      let yearlyMomentumRewards = 0
      if (isTop30 && top30Count > 0) {
        const dailyExpectedPerPillar = totalExpectedDailyMomentumsTop30 / top30Count
        yearlyMomentumRewards = yearlyMomentumRewardsTop30 * (dailyExpectedPerPillar * rewardMultiplier) / totalExpectedDailyMomentumsTop30
      } else if (!isTop30 && notTop30Count > 0) {
        const dailyExpectedPerPillar = totalExpectedDailyMomentumsNotTop30 / notTop30Count
        yearlyMomentumRewards = yearlyMomentumRewardsNotTop30 * (dailyExpectedPerPillar * rewardMultiplier) / totalExpectedDailyMomentumsNotTop30
      }

      // Calculate delegate rewards based on weight across entire network
      const pillarWeightShare = Number(weight) / Number(totalDelegatedZnn)
      const yearlyDelegateRewards = yearlyDelegateRewardPool * pillarWeightShare * rewardMultiplier

      // Apply pillar's reward share percentages (what delegates receive)
      const momentumRewardsForDelegators = yearlyMomentumRewards * (pillar.giveMomentumRewardPercentage / 100)
      const delegateRewardsForDelegators = yearlyDelegateRewards * (pillar.giveDelegateRewardPercentage / 100)

      // Calculate APR: (total rewards in smallest unit / weight) * 100
      const totalRewardsInSmallestUnit = (momentumRewardsForDelegators + delegateRewardsForDelegators) * DECIMALS
      const delegateApr = (totalRewardsInSmallestUnit / Number(weight)) * 100

      return {
        ...pillar,
        delegateApr: isNaN(delegateApr) ? 0 : delegateApr
      } as PillarWithApr
    })
  }

  // Load all pillars and calculate APRs
  async function loadPillars(pageIndex = 0, pageSize = 200) {
    isLoading.value = true
    error.value = null

    try {
      const result = await pillarService.getAllPillars(pageIndex, pageSize)
      const pillarList = result.list || []
      const totalPillarCount = result.count || pillarList.length
      pillars.value = calculatePillarAPRs(pillarList, totalPillarCount)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load pillars'
      console.error('Failed to load pillars:', err)
      pillars.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Delegate to a pillar (with optional auto-undelegate)
  async function delegateToPillar(
    wallet: Wallet,
    accountAddress: string,
    pillarName: string,
    shouldUndelegate: boolean = false
  ): Promise<void> {
    isDelegating.value = true
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

      const initialStep = shouldUndelegate
        ? 'Step 1/2: Removing current delegation'
        : `Delegating to ${pillarName}`

      await runActivity(initialStep, async ({setStep}) => {
        // First undelegate if needed
        if (shouldUndelegate) {
          const undelegateBlock = pillarService.createUndelegateBlock()
          await transactionService.sendEmbeddedContractBlock(undelegateBlock, keyPair)
          setStep(`Step 2/2: Delegating to ${pillarName}`)
        }

        // Then delegate to new pillar
        const delegateBlock = pillarService.createDelegateBlock(pillarName)
        await transactionService.sendEmbeddedContractBlock(delegateBlock, keyPair)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delegate to pillar'
      throw err
    } finally {
      isDelegating.value = false
    }
  }

  return {
    // State
    pillars,
    isLoading,
    isDelegating,
    error,

    // Methods
    loadPillars,
    delegateToPillar,
  }
}

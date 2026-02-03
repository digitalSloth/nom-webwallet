<script setup lang="ts">
import {computed, onMounted, watch} from 'vue'
import type {RewardType} from '@/core'
import {formatNumber, useRewards, useWallet} from '@/core'
import {addNumberDecimals} from 'znn-typescript-sdk'
import RewardsList from './RewardsList.vue'
import {Button} from '@nom/ui'

interface RewardsTabProps {
  activeAccountAddress: string | null
  isActive?: boolean
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<RewardsTabProps>(), {
  isActive: false,
  isWalletLocked: false
})

const emit = defineEmits<{
  showToast: [message: string, type: 'success' | 'error' | 'info' | 'warning']
  rewardsCollected: []
}>()

const rewards = useRewards()
const wallet = useWallet()

// Calculate total uncollected rewards
const totalZnnRewards = computed(() => {
  const total = rewards.rewards.value.reduce((sum, reward) => {
    return sum + BigInt(reward.reward.znnAmount.toString())
  }, 0n)
  return addNumberDecimals(total.toString(), 8)
})

const totalQsrRewards = computed(() => {
  const total = rewards.rewards.value.reduce((sum, reward) => {
    return sum + BigInt(reward.reward.qsrAmount.toString())
  }, 0n)
  return addNumberDecimals(total.toString(), 8)
})

const formattedZnnRewards = computed(() => formatNumber(totalZnnRewards.value, { decimals: 2, compact: true }))
const formattedQsrRewards = computed(() => formatNumber(totalQsrRewards.value, { decimals: 2, compact: true }))

const hasAnyRewards = computed(() => {
  return BigInt(totalZnnRewards.value.replace(/\./g, '')) > 0n ||
         BigInt(totalQsrRewards.value.replace(/\./g, '')) > 0n
})

// Load on mount if active and account exists
onMounted(async () => {
  if (props.isActive && props.activeAccountAddress) {
    await loadRewards()
  }
})

// Watch for when the tab becomes active
watch(() => props.isActive, async (isActive) => {
  if (isActive && props.activeAccountAddress) {
    await loadRewards()
  }
})

// Watch for account changes
watch(() => props.activeAccountAddress, async (newAddress) => {
  if (newAddress && props.isActive) {
    await loadRewards()
  }
})

async function loadRewards() {
  await rewards.loadRewards(props.activeAccountAddress)
}

async function collectReward(type: RewardType) {
  const accountAddress = props.activeAccountAddress
  if (!accountAddress) return

  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    emit('showToast', 'Please unlock your wallet first', 'warning')
    return
  }

  try {
    await rewards.collectReward(activeWallet, accountAddress, type)
    await loadRewards()
    emit('rewardsCollected')
    emit('showToast', `Successfully collected ${type} rewards!`, 'success')
  } catch (error) {
    console.error('Failed to collect reward:', error)
    emit('showToast', `Failed to collect reward: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error')
  }
}

async function collectAllRewards() {
  const accountAddress = props.activeAccountAddress
  if (!accountAddress || rewards.rewards.value.length === 0) return

  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    emit('showToast', 'Please unlock your wallet first', 'warning')
    return
  }

  let successCount = 0
  let failCount = 0

  const rewardTypes = [...rewards.rewards.value]
  for (const reward of rewardTypes) {
    // Skip if no rewards
    if (BigInt(reward.reward.znnAmount.toString()) === 0n &&
        BigInt(reward.reward.qsrAmount.toString()) === 0n) {
      continue
    }

    try {
      await rewards.collectReward(activeWallet, accountAddress, reward.type)
      successCount++
      // Small delay between collections
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      console.error(`Failed to collect ${reward.type} reward:`, error)
      failCount++
    }
  }

  await loadRewards()

  if (successCount > 0) {
    emit('rewardsCollected')
    emit('showToast', `Successfully collected ${successCount} reward(s)${failCount > 0 ? `, ${failCount} failed` : ''}`, 'success')
  } else if (failCount > 0) {
    emit('showToast', 'Failed to collect all rewards', 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="rewards.isLoading.value" class="text-center py-8 text-muted-foreground">
      Loading rewards...
    </div>
    <div v-else class="space-y-6">
      <!-- Total Rewards Summary -->
      <div v-if="hasAnyRewards" class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="font-semibold text-lg">Total Uncollected Rewards</div>
          <Button
              size="sm"
              :disabled="rewards.isCollecting.value || isWalletLocked"
              @click="collectAllRewards"
          >
            {{ rewards.isCollecting.value ? 'Collecting...' : 'Collect All' }}
          </Button>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div
              v-if="parseFloat(totalZnnRewards) > 0"
              class="p-3 rounded-md bg-green-500/10 border border-green-500/20"
          >
            <div class="text-xs text-muted-foreground mb-1">Total ZNN</div>
            <div
                class="text-2xl font-mono font-bold text-green-600 dark:text-green-400"
                :title="totalZnnRewards"
            >
              {{ formattedZnnRewards }}
            </div>
          </div>
          <div
              v-if="parseFloat(totalQsrRewards) > 0"
              class="p-3 rounded-md bg-blue-500/10 border border-blue-500/20"
          >
            <div class="text-xs text-muted-foreground mb-1">Total QSR</div>
            <div
                class="text-2xl font-mono font-bold text-blue-600 dark:text-blue-400"
                :title="totalQsrRewards"
            >
              {{ formattedQsrRewards }}
            </div>
          </div>
        </div>
      </div>

      <!-- Individual Rewards List -->
      <RewardsList
        :rewards="rewards.rewards.value"
        :is-collecting="rewards.isCollecting.value"
        :collecting-type="rewards.collectingType.value"
        :is-wallet-locked="isWalletLocked"
        @collect="collectReward"
      />
    </div>
  </div>
</template>

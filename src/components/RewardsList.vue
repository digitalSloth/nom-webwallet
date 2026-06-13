<script setup lang="ts">
import {computed} from 'vue'
import {addNumberDecimals} from 'znn-typescript-sdk'
import type {RewardInfo, RewardType} from '@/core'
import {formatTokenDisplay} from '@/core'
import {Button, Item, ItemContent, ItemDescription, ItemTitle,} from 'nom-ui'

export interface RewardsListProps {
  rewards: RewardInfo[]
  isCollecting?: boolean
  collectingType?: string | null
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<RewardsListProps>(), {
  isCollecting: false,
  collectingType: null,
  isWalletLocked: false,
})

const emit = defineEmits<{
  collect: [type: RewardType]
}>()

// Map reward types to display names
const rewardTypeNames: Record<string, string> = {
  pillar: 'Pillar',
  sentinel: 'Sentinel',
  stake: 'Stake',
  liquidity: 'Liquidity',
}

// Map reward types to descriptions
const rewardTypeDescriptions: Record<string, string> = {
  pillar: 'Rewards from delegating or running a Pillar',
  sentinel: 'Rewards from running a Sentinel',
  stake: 'Rewards from staking ZNN',
  liquidity: 'Rewards from providing liquidity',
}

// Helper to format token amounts for display (rounds + avoids misleading "0")
function formatAmount(amount: string, decimals: number = 8): string {
  return formatTokenDisplay(addNumberDecimals(amount, decimals))
}

// Helper to check if reward has any amounts
function hasRewards(reward: RewardInfo): boolean {
  return BigInt(reward.reward.znnAmount.toString()) > 0n || BigInt(reward.reward.qsrAmount.toString()) > 0n
}

// Filter out rewards with zero amounts
const rewardsWithAmounts = computed(() => {
  return props.rewards.filter(hasRewards)
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="rewardsWithAmounts.length === 0" class="text-center py-8 text-muted-foreground">
      <p>No uncollected rewards available</p>
    </div>

    <div v-else class="space-y-3">
      <Item
        v-for="reward in rewardsWithAmounts"
        :key="reward.type"
        variant="muted"
        class="border-border"
      >
        <ItemContent class="flex-1">
          <div class="flex items-center justify-between">
            <ItemTitle>{{ rewardTypeNames[reward.type] }}</ItemTitle>
            <Button
              size="sm"
              :disabled="isCollecting || isWalletLocked"
              @click="emit('collect', reward.type)"
            >
              {{ collectingType === reward.type ? 'Collecting...' : 'Collect' }}
            </Button>
          </div>
          <ItemDescription class="space-y-2 line-clamp-none">
            <div class="text-xs">
              {{ rewardTypeDescriptions[reward.type] }}
            </div>
            <div class="flex gap-2 sm:gap-4">
              <div
                v-if="BigInt(reward.reward.znnAmount.toString()) > 0n"
                class="flex-1 min-w-0 p-3 rounded-md bg-green-500/10 border border-green-500/20"
              >
                <div class="text-xs text-muted-foreground mb-1">ZNN</div>
                <div
                  class="text-base sm:text-lg font-mono font-bold text-green-600 dark:text-green-400 break-all"
                >
                  {{ formatAmount(reward.reward.znnAmount.toString()) }}
                </div>
              </div>

              <div
                v-if="BigInt(reward.reward.qsrAmount.toString()) > 0n"
                class="flex-1 min-w-0 p-3 rounded-md bg-blue-500/10 border border-blue-500/20"
              >
                <div class="text-xs text-muted-foreground mb-1">QSR</div>
                <div
                  class="text-base sm:text-lg font-mono font-bold text-blue-600 dark:text-blue-400 break-all"
                >
                  {{ formatAmount(reward.reward.qsrAmount.toString()) }}
                </div>
              </div>
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>

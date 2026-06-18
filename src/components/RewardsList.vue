<script setup lang="ts">
import {computed} from 'vue'
import {addNumberDecimals} from 'znn-typescript-sdk'
import type {RewardInfo, RewardType} from '@/core'
import {Amount, Button, Item, ItemContent, ItemDescription, ItemTitle} from 'nom-ui'

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

// Helper to check if reward has any amounts
function hasRewards(reward: RewardInfo): boolean {
  return (
    BigInt(reward.reward.znnAmount.toString()) > 0n ||
    BigInt(reward.reward.qsrAmount.toString()) > 0n
  )
}

// Filter out rewards with zero amounts
const rewardsWithAmounts = computed(() => {
  return props.rewards.filter(hasRewards)
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="rewardsWithAmounts.length === 0" class="py-8 text-center text-muted-foreground">
      <p>No rewards to collect yet — they'll appear here once you've earned some from delegating, staking, or running a node.</p>
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
          <ItemDescription class="line-clamp-none space-y-2">
            <div class="text-xs">
              {{ rewardTypeDescriptions[reward.type] }}
            </div>
            <div class="flex gap-2 sm:gap-4">
              <div
                v-if="BigInt(reward.reward.znnAmount.toString()) > 0n"
                class="min-w-0 flex-1 rounded-md border border-zenon-green/30 bg-zenon-green/20 p-3"
              >
                <Amount
                  :value="addNumberDecimals(reward.reward.znnAmount.toString(), 8)"
                  :decimals="8"
                  symbol="ZNN"
                  class="font-mono text-lg font-bold break-all text-foreground"
                />
              </div>

              <div
                v-if="BigInt(reward.reward.qsrAmount.toString()) > 0n"
                class="min-w-0 flex-1 rounded-md border border-zenon-blue/30 bg-zenon-blue/20 p-3"
              >
                <Amount
                  :value="addNumberDecimals(reward.reward.qsrAmount.toString(), 8)"
                  :decimals="8"
                  symbol="QSR"
                  class="font-mono text-lg font-bold break-all text-foreground"
                />
              </div>
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>

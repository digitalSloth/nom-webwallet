<script setup lang="ts">
import {computed} from 'vue'
import type {StakeEntry} from 'znn-typescript-sdk'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {Button, Item, ItemContent, ItemDescription, ItemTitle} from 'nom-ui'

export interface StakeListProps {
  stakes: StakeEntry[]
  isCanceling?: boolean
  cancelingStakeId?: string | null
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<StakeListProps>(), {
  isCanceling: false,
  cancelingStakeId: null,
  isWalletLocked: false,
})

const emit = defineEmits<{
  cancel: [stakeId: string]
}>()

// Helper to format ZNN amount
function formatZnnAmount(amount: string): string {
  return addNumberDecimals(amount, 8)
}

// Helper to check if stake can be canceled (stake has expired)
function canCancel(stake: StakeEntry): boolean {
  const now = Math.floor(Date.now() / 1000) // Current time in seconds
  return now >= stake.expirationTimestamp
}

// Helper to calculate time remaining until stake expires
function getTimeRemaining(stake: StakeEntry): string {
  const now = Math.floor(Date.now() / 1000) // Current time in seconds

  if (now >= stake.expirationTimestamp) {
    return 'Can cancel now'
  }

  const secondsRemaining = stake.expirationTimestamp - now
  const daysRemaining = Math.floor(secondsRemaining / 86400)
  const hoursRemaining = Math.floor((secondsRemaining % 86400) / 3600)
  const minutesRemaining = Math.floor((secondsRemaining % 3600) / 60)

  if (daysRemaining > 0) {
    return `${daysRemaining}d ${hoursRemaining}h remaining`
  } else if (hoursRemaining > 0) {
    return `${hoursRemaining}h ${minutesRemaining}m remaining`
  }
  return `${minutesRemaining}m remaining`
}

// Helper to format duration
function formatDuration(startTimestamp: number, expirationTimestamp: number): string {
  const durationSeconds = expirationTimestamp - startTimestamp
  const months = Math.floor(durationSeconds / (30 * 86400))
  const days = Math.floor(durationSeconds / 86400)
  const hours = Math.floor(durationSeconds / 3600)

  if (months > 0) {
    return `${months} month${months > 1 ? 's' : ''}`
  } else if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''}`
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`
  }
  return 'Less than 1 hour'
}

// Compute stakes with cancel status
const stakesWithStatus = computed(() => {
  return props.stakes.map(stake => ({
    ...stake,
    canCancel: canCancel(stake),
    timeRemaining: getTimeRemaining(stake),
    duration: formatDuration(stake.startTimestamp, stake.expirationTimestamp)
  }))
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="stakes.length === 0" class="text-center py-8 text-muted-foreground">
      <p>No active stakes</p>
    </div>

    <div v-else class="space-y-3">
      <Item
        v-for="stake in stakesWithStatus"
        :key="stake.id.toString()"
        variant="muted"
        class="border-border"
      >
        <ItemContent class="flex-1">
          <div class="flex items-center justify-between">
            <ItemTitle>ZNN Stake</ItemTitle>
            <Button
              size="sm"
              variant="destructive"
              :disabled="!stake.canCancel || isCanceling || isWalletLocked"
              @click="emit('cancel', stake.id.toString())"
            >
              {{ cancelingStakeId === stake.id.toString() ? 'Canceling...' : 'Cancel' }}
            </Button>
          </div>
          <ItemDescription class="space-y-2 line-clamp-none">
            <div class="text-xs">
              Duration: {{ stake.duration }}
            </div>
            <div class="text-xs">
              {{ stake.timeRemaining }}
            </div>
            <div class="p-3 rounded-md bg-green-500/10 border border-green-500/20">
              <div class="text-xs text-muted-foreground mb-1">Staked Amount</div>
              <div class="text-lg font-mono font-bold text-green-600 dark:text-green-400">
                {{ formatZnnAmount(stake.amount.toString()) }} ZNN
              </div>
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>

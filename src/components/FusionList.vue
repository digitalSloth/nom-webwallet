<script setup lang="ts">
import {computed} from 'vue'
import type {FusionEntry} from 'znn-typescript-sdk'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {formatTokenDisplay, truncateAddress} from '@/core'
import {BLOCKS_PER_HOUR, PLASMA_REVOKE_BLOCKS as REVOKE_TIME_BLOCKS} from '@/config'
import {Button, Item, ItemContent, ItemDescription, ItemTitle} from '@nom/ui'

export interface FusionListProps {
  fusions: FusionEntry[]
  isCanceling?: boolean
  cancelingFusionId?: string | null
  currentMomentum?: number
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<FusionListProps>(), {
  isCanceling: false,
  cancelingFusionId: null,
  currentMomentum: 0,
  isWalletLocked: false,
})

const emit = defineEmits<{
  cancel: [fusionId: string]
}>()

// Helper to format QSR amount for display
function formatQsrAmount(amount: string): string {
  return formatTokenDisplay(addNumberDecimals(amount, 8))
}

// Helper to check if fusion can be canceled
function canCancel(fusion: FusionEntry): boolean {
  if (!props.currentMomentum) return false
  const blocksPassed = props.currentMomentum - fusion.expirationHeight + REVOKE_TIME_BLOCKS
  return blocksPassed >= REVOKE_TIME_BLOCKS
}

// Helper to calculate time remaining until cancelable
function getTimeRemaining(fusion: FusionEntry): string {
  if (!props.currentMomentum) return 'Calculating...'

  const blocksPassed = props.currentMomentum - fusion.expirationHeight + REVOKE_TIME_BLOCKS

  if (blocksPassed >= REVOKE_TIME_BLOCKS) {
    return 'Can cancel now'
  }

  const blocksRemaining = REVOKE_TIME_BLOCKS - blocksPassed
  const hoursRemaining = Math.floor(blocksRemaining / BLOCKS_PER_HOUR)
  const minutesRemaining = Math.floor((blocksRemaining % BLOCKS_PER_HOUR) / 6) // 6 blocks per minute

  if (hoursRemaining > 0) {
    return `${hoursRemaining}h ${minutesRemaining}m remaining`
  }
  return `${minutesRemaining}m remaining`
}

// Compute fusions with cancel status
const fusionsWithStatus = computed(() => {
  return props.fusions.map(fusion => ({
    ...fusion,
    canCancel: canCancel(fusion),
    timeRemaining: getTimeRemaining(fusion)
  }))
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="fusions.length === 0" class="text-center py-8 text-muted-foreground">
      <p>No active plasma fusions</p>
    </div>

    <div v-else class="space-y-3">
      <Item
        v-for="fusion in fusionsWithStatus"
        :key="fusion.id.toString()"
        variant="muted"
        class="border-border"
      >
        <ItemContent class="flex-1">
          <div class="flex items-center justify-between">
            <ItemTitle>Plasma Fusion</ItemTitle>
            <Button
              size="sm"
              variant="destructive"
              :disabled="!fusion.canCancel || isCanceling || isWalletLocked"
              @click="emit('cancel', fusion.id.toString())"
            >
              {{ cancelingFusionId === fusion.id.toString() ? 'Canceling...' : 'Cancel' }}
            </Button>
          </div>
          <ItemDescription class="space-y-2 line-clamp-none">
            <div class="text-xs" :title="fusion.beneficiary.toString()">
              Beneficiary: {{ truncateAddress(fusion.beneficiary.toString()) }}
            </div>
            <div class="text-xs">
              {{ fusion.timeRemaining }}
            </div>
            <div class="p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
              <div class="text-xs text-muted-foreground mb-1">Fused Amount</div>
              <div class="text-lg font-mono font-bold text-blue-600 dark:text-blue-400 break-all">
                {{ formatQsrAmount(fusion.qsrAmount.toString()) }} QSR
              </div>
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import type {FusionEntry} from 'znn-typescript-sdk'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {BLOCKS_PER_HOUR, PLASMA_REVOKE_BLOCKS as REVOKE_TIME_BLOCKS} from '@/config'
import {Address, Amount, Button, Item, ItemContent, ItemDescription, ItemTitle} from 'nom-ui'

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
  return props.fusions.map((fusion) => ({
    ...fusion,
    canCancel: canCancel(fusion),
    timeRemaining: getTimeRemaining(fusion),
  }))
})
</script>

<template>
  <div class="space-y-3">
    <div v-if="fusions.length === 0" class="py-8 text-center text-muted-foreground">
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
          <ItemDescription class="line-clamp-none space-y-2">
            <div class="text-xs">
              Beneficiary: <Address :address="fusion.beneficiary.toString()" :copy="false" />
            </div>
            <div class="text-xs">
              {{ fusion.timeRemaining }}
            </div>
            <div class="rounded-md border border-zenon-blue/30 bg-zenon-blue/20 p-3">
              <div class="mb-1 text-ledger text-muted-foreground">Fused Amount</div>
              <Amount
                :value="addNumberDecimals(fusion.qsrAmount.toString(), 8)"
                :decimals="8"
                symbol="QSR"
                class="font-mono text-lg font-bold break-all text-foreground"
              />
            </div>
          </ItemDescription>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>

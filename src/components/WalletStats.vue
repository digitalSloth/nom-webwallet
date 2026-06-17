<script setup lang="ts">
import {computed, ref} from 'vue'
import type {PlasmaLevel} from '@/core'
import {ZapIcon} from 'lucide-vue-next'
import {useScrollFade} from 'nom-ui'

export interface WalletStatsProps {
  tokenCount: number
  accountHeight: number
  plasmaLevel: PlasmaLevel
  delegatedPillar: string | null
  totalZnnRewards: string
  totalQsrRewards: string
}

const props = defineProps<WalletStatsProps>()

const hasRewards = computed(() => {
  return parseFloat(props.totalZnnRewards) > 0 || parseFloat(props.totalQsrRewards) > 0
})

const scrollRef = ref<HTMLElement>()
const { maskStyle } = useScrollFade(scrollRef)

const getPlasmaColor = () => {
  switch (props.plasmaLevel) {
    case 'high':
      return 'text-success'
    case 'medium':
      return 'text-warning'
    case 'low':
      return 'text-destructive'
  }
}
</script>

<template>
  <div class="rounded-lg border bg-muted/30 px-4 py-3">
    <div
      ref="scrollRef"
      :style="maskStyle"
      class="flex touch-pan-x [scrollbar-width:none] items-center gap-6 overflow-x-auto overflow-y-hidden text-sm [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      <!-- Account Height -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-ledger text-muted-foreground">Account Height:</span>
        <span class="tabular-nums font-medium">{{ accountHeight }}</span>
      </div>

      <!-- Token Count -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-ledger text-muted-foreground">Tokens:</span>
        <span class="tabular-nums font-medium">{{ tokenCount }}</span>
      </div>

      <!-- Plasma Level -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-ledger text-muted-foreground">Plasma:</span>
        <div class="flex items-center gap-1">
          <ZapIcon :class="['h-4 w-4', getPlasmaColor()]" />
          <span class="font-medium capitalize">{{ plasmaLevel }}</span>
        </div>
      </div>

      <!-- Delegated Pillar -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-ledger text-muted-foreground">Pillar:</span>
        <span class="font-medium">{{ delegatedPillar || 'None' }}</span>
      </div>

      <!-- Rewards -->
      <div v-if="hasRewards" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="font-medium text-primary">Pending Rewards</span>
        <span class="h-2 w-2 animate-pulse rounded-full bg-primary" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
import type {PlasmaLevel} from '@/core'
import {ZapIcon} from 'lucide-vue-next'
import {useScrollFade} from '@nom/ui'

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
      return 'text-green-500'
    case 'medium':
      return 'text-yellow-500'
    case 'low':
      return 'text-red-500'
  }
}
</script>

<template>
  <div class="px-4 py-3 border rounded-lg bg-muted/30">
    <div
      ref="scrollRef"
      :style="maskStyle"
      class="flex items-center gap-6 text-sm overflow-x-auto overflow-y-hidden touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      <!-- Account Height -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-muted-foreground">Account Height:</span>
        <span class="font-medium">{{ accountHeight }}</span>
      </div>

      <!-- Token Count -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-muted-foreground">Tokens:</span>
        <span class="font-medium">{{ tokenCount }}</span>
      </div>

      <!-- Plasma Level -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-muted-foreground">Plasma:</span>
        <div class="flex items-center gap-1">
          <ZapIcon :class="['w-4 h-4', getPlasmaColor()]" />
          <span class="font-medium capitalize">{{ plasmaLevel }}</span>
        </div>
      </div>

      <!-- Delegated Pillar -->
      <div class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-muted-foreground">Pillar:</span>
        <span class="font-medium">{{ delegatedPillar || 'None' }}</span>
      </div>

      <!-- Rewards -->
      <div v-if="hasRewards" class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span class="text-primary font-medium">Pending Rewards</span>
        <span class="w-2 h-2 bg-primary rounded-full animate-pulse" />
      </div>
    </div>
  </div>
</template>

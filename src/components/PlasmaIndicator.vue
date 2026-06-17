<script setup lang="ts">
import {computed} from 'vue'
import type {PlasmaLevel} from '@/core'
import {ZapIcon} from 'lucide-vue-next'
import {Tooltip, TooltipContent, TooltipTrigger} from 'nom-ui'

const props = defineProps<{
  plasmaLevel: PlasmaLevel
  isGeneratingPow?: boolean
}>()

// While generating PoW the wallet has no plasma to spend, so flag it with the
// brand pink. Otherwise follow the same level colours as WalletStats.
const colorClass = computed(() => {
  if (props.isGeneratingPow) return 'text-zenon-pink'
  switch (props.plasmaLevel) {
    case 'high':
      return 'text-success'
    case 'medium':
      return 'text-warning'
    case 'low':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
})
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="inline-flex" role="img" aria-label="Plasma level">
        <ZapIcon :class="['h-5 w-5', colorClass, isGeneratingPow && 'animate-pulse']" />
      </span>
    </TooltipTrigger>
    <TooltipContent>
      <p class="font-medium">{{ isGeneratingPow ? 'Generating plasma…' : 'Plasma' }}</p>
      <p class="text-xs capitalize">{{ plasmaLevel }}</p>
    </TooltipContent>
  </Tooltip>
</template>

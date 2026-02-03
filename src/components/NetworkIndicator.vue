<script setup lang="ts">
import {GlobeIcon, GlobeXIcon} from 'lucide-vue-next'

export interface NetworkIndicatorProps {
  connected: boolean
}

defineProps<NetworkIndicatorProps>()
</script>

<template>
  <GlobeIcon
      v-if="connected"
      class="w-6 h-6 text-green-500"
      role="img"
      aria-label="Network connected"
  />
  <GlobeXIcon
      v-else
      class="w-6 h-6 text-red-500 animate-pulse"
      role="img"
      aria-label="Network disconnected"
  />
</template>

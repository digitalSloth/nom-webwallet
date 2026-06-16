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
    class="h-6 w-6 text-green-500"
    role="img"
    aria-label="Network connected"
  />
  <GlobeXIcon
    v-else
    class="h-6 w-6 animate-pulse text-red-500"
    role="img"
    aria-label="Network disconnected"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ZapIcon } from 'lucide-vue-next'
import type { PlasmaLevel } from '@/core'
import { networkLabel } from '@/shared/lib/format'

const props = defineProps<{
  connected: boolean
  nodeDown: boolean
  chainId: number
  plasmaLevel: PlasmaLevel | null
}>()

const plasmaText = computed(() => (props.plasmaLevel ? `Plasma ${props.plasmaLevel}` : ''))
const plasmaClass = computed(() => {
  if (props.plasmaLevel === 'high') return 'text-success'
  if (props.plasmaLevel === 'medium') return 'text-info'
  return 'text-warning'
})
</script>

<template>
  <div class="flex items-center justify-between px-4 py-2">
    <RouterLink
      :to="{ name: 'settings-network' }"
      class="flex items-center gap-2 text-ledger"
      :class="nodeDown ? 'text-destructive' : 'text-muted-foreground'"
      aria-label="Network settings"
    >
      <span
        class="size-1.5 rounded-full"
        :class="connected && !nodeDown ? 'bg-success' : 'bg-destructive'"
        aria-hidden="true"
      />
      <template v-if="nodeDown">Node unreachable</template>
      <template v-else>
        {{ networkLabel(chainId) }} · {{ connected ? 'connected' : 'disconnected' }}
      </template>
    </RouterLink>
    <RouterLink
      v-if="plasmaLevel"
      :to="{ name: 'plasma' }"
      class="flex items-center gap-1 text-xs"
      :class="plasmaClass"
      :aria-label="`${plasmaText}, manage plasma`"
    >
      <ZapIcon class="size-3" />
      {{ plasmaText }}
    </RouterLink>
  </div>
</template>

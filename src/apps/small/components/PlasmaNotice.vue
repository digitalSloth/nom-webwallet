<script setup lang="ts">
import { computed } from 'vue'
import { ZapIcon } from 'lucide-vue-next'
import type { PlasmaLevel } from '@/core'

const props = defineProps<{ level: PlasmaLevel }>()

const boxClass = computed(() => {
  if (props.level === 'medium') return 'border-info'
  if (props.level === 'low') return 'border-warning'
  return 'bg-muted'
})

const iconClass = computed(() => {
  if (props.level === 'medium') return 'text-info'
  if (props.level === 'low') return 'text-warning'
  return 'text-success'
})
</script>

<template>
  <div :class="['flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm', boxClass]">
    <ZapIcon :class="['mt-0.5 size-4 shrink-0', iconClass]" />
    <div class="flex-1">
      <template v-if="level === 'high'">Plasma high · sends instantly, no PoW</template>
      <template v-else-if="level === 'medium'">
        Plasma medium · this send may need PoW on your device
      </template>
      <template v-else>
        <div>Low plasma · this send needs PoW on your device</div>
        <div class="mt-0.5 text-xs text-muted-foreground">
          It usually takes under a minute. Keep the wallet open until it is sent.
        </div>
      </template>
      <RouterLink
        v-if="level !== 'high'"
        :to="{ name: 'plasma' }"
        class="mt-1 inline-block text-xs font-medium text-info"
      >
        Get plasma
      </RouterLink>
    </div>
    <span v-if="level === 'high'" class="text-muted-foreground">Fee 0</span>
  </div>
</template>

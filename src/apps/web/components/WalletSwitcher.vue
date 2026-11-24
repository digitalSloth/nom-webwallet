<script setup lang="ts">
import { ref, watch } from 'vue'
import WalletMenu from '@/shared/components/WalletMenu.vue'
import { usePhoneLayout } from '../breakpoint'

withDefaults(defineProps<{ side?: 'right' | 'bottom'; align?: 'start' | 'center' | 'end' }>(), {
  side: 'right',
  align: 'start',
})

const open = ref(false)

// The trigger of this instance is hidden once the layout flips.
watch(usePhoneLayout(), () => {
  open.value = false
})
</script>

<template>
  <WalletMenu v-model:open="open" :side="side" :align="align">
    <slot />
  </WalletMenu>
</template>

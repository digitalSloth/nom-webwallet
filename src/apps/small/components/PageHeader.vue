<script setup lang="ts">
import { Button } from 'nom-ui'
import { ChevronLeftIcon } from 'lucide-vue-next'

defineProps<{ title: string; backDisabled?: boolean; topLevel?: boolean }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <header
    class="flex items-center gap-1 border-b"
    :class="topLevel ? 'px-4 py-3.5' : 'py-2.5 pr-3 pl-2'"
  >
    <Button
      v-if="!topLevel"
      variant="ghost"
      size="icon-sm"
      aria-label="Back"
      :disabled="backDisabled"
      @click="$emit('back')"
    >
      <ChevronLeftIcon />
    </Button>
    <h1 class="flex-1 text-base font-semibold">{{ title }}</h1>
    <slot />
  </header>
</template>

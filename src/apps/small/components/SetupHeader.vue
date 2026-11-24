<script setup lang="ts">
import { Button } from 'nom-ui'
import { ChevronLeftIcon } from 'lucide-vue-next'

defineProps<{ label: string; step: number; steps: number; backDisabled?: boolean }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <header class="space-y-3 px-3 pt-3 pb-2">
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back"
        :disabled="backDisabled"
        @click="$emit('back')"
      >
        <ChevronLeftIcon />
      </Button>
      <span class="text-ledger">{{ label }}</span>
    </div>
    <div
      role="progressbar"
      aria-label="Setup progress"
      :aria-valuenow="step"
      aria-valuemin="1"
      :aria-valuemax="steps"
      class="flex gap-1.5 px-1"
    >
      <span
        v-for="i in steps"
        :key="i"
        class="h-1 flex-1 rounded-full"
        :class="i <= step ? 'bg-plasma' : 'bg-muted'"
      />
    </div>
  </header>
</template>

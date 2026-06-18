<script setup lang="ts">
import {computed} from 'vue'
import type {PasswordStrength} from '@/core'

const props = defineProps<{ strength: PasswordStrength }>()

const barClass = computed(() => {
  const s = props.strength.score
  if (s <= 1) return 'bg-destructive'
  if (s === 2) return 'bg-warning'
  if (s === 3) return 'bg-success'
  return 'bg-success'
})
</script>

<template>
  <div class="space-y-1">
    <div class="flex gap-1">
      <div
        v-for="i in 4"
        :key="i"
        class="h-1.5 flex-1 rounded-full"
        :class="i <= strength.score ? barClass : 'bg-muted'"
      />
    </div>
    <div class="flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{{ strength.label }}</span>
      <span v-if="strength.suggestions.length" class="text-muted-foreground">
        {{ strength.suggestions[0] }}
      </span>
    </div>
  </div>
</template>

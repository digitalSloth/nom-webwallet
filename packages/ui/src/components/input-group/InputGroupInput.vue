<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@nom/ui/lib/utils.ts'
import { Input } from '@nom/ui/components/input'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Input
    data-slot="input-group-control"
    :class="cn(
      'flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-transparent shadow-none ring-offset-transparent dark:bg-transparent',
      props.class,
    )"
  />
</template>

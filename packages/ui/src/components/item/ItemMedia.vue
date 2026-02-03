<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import type { ItemMediaVariants } from "./index.ts"
import { cn } from '@nom/ui/lib/utils.ts'
import { itemMediaVariants } from "./index.ts"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  variant?: ItemMediaVariants["variant"]
}>()
</script>

<template>
  <div
    data-slot="item-media"
    :data-variant="props.variant"
    :class="cn(itemMediaVariants({ variant }), props.class)"
  >
    <slot />
  </div>
</template>

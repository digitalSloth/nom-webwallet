<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { ItemVariants } from "./index.ts"
import { Primitive } from "reka-ui"
import { cn } from '@nom/ui/lib/utils.ts'
import { itemVariants } from "./index.ts"

const props = withDefaults(defineProps<PrimitiveProps & {
  class?: HTMLAttributes["class"]
  variant?: ItemVariants["variant"]
  size?: ItemVariants["size"]
}>(), {
  as: "div",
})
</script>

<template>
  <Primitive
    data-slot="item"
    :as="as"
    :as-child="asChild"
    :class="cn(itemVariants({ variant, size }), props.class)"
  >
    <slot />
  </Primitive>
</template>

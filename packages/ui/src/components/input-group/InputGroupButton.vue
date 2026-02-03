<script setup lang="ts">
import { cn } from '@nom/ui/lib/utils.ts'
import { Button } from '@nom/ui/components/button'
import { inputGroupButtonVariants, type InputGroupButtonProps } from "@nom/ui/components/input-group"

const props = withDefaults(defineProps<InputGroupButtonProps>(), {
  size: "xs",
  variant: "ghost",
})
</script>

<template>
  <Button
    :data-size="props.size"
    :variant="props.variant"
    :class="cn(inputGroupButtonVariants({ size: props.size }), props.class)"
  >
    <slot />
  </Button>
</template>

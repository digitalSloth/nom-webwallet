<script setup lang="ts">
import {cn} from '../../lib/utils'
import {Button} from '../button'
import {type InputGroupButtonProps, inputGroupButtonVariants} from "../input-group"

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

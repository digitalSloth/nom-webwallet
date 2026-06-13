<script setup lang="ts">
import type {HTMLAttributes} from "vue"
import type {AlertVariants} from "./index.ts"
import {alertVariants} from "./index.ts"
import {cn} from '../../lib/utils'

const props = defineProps<{
  class?: HTMLAttributes["class"]
  variant?: AlertVariants["variant"]
}>()
</script>

<template>
  <div :class="cn(alertVariants({ variant }), props.class)" role="alert">
    <slot />
  </div>
</template>

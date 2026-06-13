<script setup lang="ts">
import type {HTMLAttributes} from "vue"
import {cn} from "../../lib/utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
}>()

const tag = props.as ?? "h3"
</script>

<template>
  <component
    :is="tag"
    :class="cn('font-semibold leading-none tracking-tight', props.class)"
  >
    <slot />
  </component>
</template>

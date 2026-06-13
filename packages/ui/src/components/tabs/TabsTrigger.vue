<script setup lang="ts">
import type {TabsTriggerProps} from "reka-ui"
import {TabsTrigger, useForwardProps} from "reka-ui"
import type {HTMLAttributes} from "vue"
import {reactiveOmit} from "@vueuse/core"
import {cn} from '../../lib/utils'

type TabsTriggerVariant = 'default' | 'underline'

const props = withDefaults(
  defineProps<TabsTriggerProps & { class?: HTMLAttributes["class"]; variant?: TabsTriggerVariant }>(),
  { variant: 'default' },
)

const delegatedProps = reactiveOmit(props, "class", "variant")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <TabsTrigger
    v-bind="forwardedProps"
    :class="cn(
      'inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 transition-colors',
      variant === 'underline'
        ? 'flex-1 px-3 sm:px-6 py-3 text-sm sm:text-base -mb-px border-b-2 border-transparent text-muted-foreground hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-primary'
        : 'rounded-md px-3 py-1 z-10 relative data-[state=active]:text-foreground',
      props.class,
    )"
  >
    <span class="truncate">
      <slot />
    </span>
  </TabsTrigger>
</template>

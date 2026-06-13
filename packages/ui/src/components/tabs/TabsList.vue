<script setup lang="ts">
import type {TabsListProps} from 'reka-ui'
import {injectTabsRootContext, TabsList} from 'reka-ui'
import type {HTMLAttributes} from 'vue'
import {nextTick, onMounted, onUnmounted, ref, watch} from 'vue'
import {reactiveOmit} from '@vueuse/core'
import {cn} from '../../lib/utils'
import {useScrollFade} from '../../composables/useScrollFade'

type TabsListVariant = 'default' | 'underline'

const props = withDefaults(
  defineProps<TabsListProps & { class?: HTMLAttributes['class']; variant?: TabsListVariant }>(),
  { variant: 'default' }
)

const delegatedProps = reactiveOmit(props, 'class', 'variant')

const tabsListRef = ref<HTMLElement>()
const tabsContext = injectTabsRootContext()

// --- default variant: sliding active-tab indicator ---
const indicatorStyle = ref({
  left: 0,
  top: 0,
  width: 0,
  height: 0,
})

const updateIndicator = () => {
  nextTick(() => {
    if (!tabsListRef.value) return

    const activeTab = tabsListRef.value.querySelector<HTMLElement>('[data-state="active"]')
    if (!activeTab) return

    const activeRect = activeTab.getBoundingClientRect()
    const tabsRect = tabsListRef.value.getBoundingClientRect()

    requestAnimationFrame(() => {
      indicatorStyle.value = {
        left: activeRect.left - tabsRect.left,
        top: activeRect.top - tabsRect.top,
        width: activeRect.width,
        height: activeRect.height,
      }
    })
  })
}

// --- underline variant: horizontal scroll + edge fade when tabs overflow ---
// `maskStyle` is {} until the row actually overflows, so it's a no-op for the
// non-scrolling `default` variant.
const { maskStyle, update: updateEdges } = useScrollFade(() => tabsContext?.tabsList.value)

const scrollActiveIntoView = () => {
  const el = tabsContext?.tabsList.value
  if (!el) return
  const active = el.querySelector<HTMLElement>('[data-state="active"]')
  if (!active) return
  // Center the active tab within the scroll viewport (clamped to the ends by
  // the browser).
  el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2
}

// Keep the selected tab visible as the selection changes.
watch(
  () => tabsContext?.modelValue.value,
  () =>
    nextTick(() => {
      scrollActiveIntoView()
      updateEdges()
    })
)

let observer: MutationObserver | null = null

onMounted(() => {
  if (props.variant === 'default') {
    setTimeout(updateIndicator, 0)
    window.addEventListener('resize', updateIndicator)

    observer = new MutationObserver(updateIndicator)
    if (tabsListRef.value) {
      observer.observe(tabsListRef.value, {
        attributes: true,
        childList: true,
        subtree: true,
      })
    }
    return
  }

  // underline variant — scroll listeners are handled by useScrollFade.
  nextTick(() => {
    updateEdges()
    scrollActiveIntoView()
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator)
  observer?.disconnect()
})
</script>

<template>
  <div ref="tabsListRef" class="relative">
    <TabsList
      v-bind="delegatedProps"
      :data-variant="variant"
      :style="maskStyle"
      :class="
        cn(
          variant === 'underline'
            ? 'flex w-full items-stretch justify-stretch border-b text-muted-foreground overflow-x-auto overflow-y-hidden touch-pan-x [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
            : 'inline-flex items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground relative',
          props.class
        )
      "
    >
      <slot />
    </TabsList>
    <div
      v-if="variant === 'default'"
      class="absolute rounded-md bg-background shadow transition-all duration-300 ease-in-out"
      :style="{
        left: `${indicatorStyle.left}px`,
        top: `${indicatorStyle.top}px`,
        width: `${indicatorStyle.width}px`,
        height: `${indicatorStyle.height}px`,
      }"
    />
  </div>
</template>

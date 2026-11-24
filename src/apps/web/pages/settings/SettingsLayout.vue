<script setup lang="ts">
import { defineAsyncComponent, type Component } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
// The page of each tab. The heading and tabs stay mounted while it changes.
const pages: Record<string, Component> = {
  'settings-wallets': defineAsyncComponent(() => import('./Wallets.vue')),
  'settings-security': defineAsyncComponent(() => import('./Security.vue')),
  'settings-network': defineAsyncComponent(() => import('./Network.vue')),
}

const tabs = [
  { label: 'Wallets', to: { name: 'settings-wallets' } },
  { label: 'Security', to: { name: 'settings-security' } },
  { label: 'Network', to: { name: 'settings-network' } },
]
</script>

<template>
  <div class="mx-auto flex max-w-[1040px] flex-col gap-5">
    <h1 class="text-3xl font-semibold tracking-tight">Settings</h1>
    <nav aria-label="Settings sections" class="flex flex-wrap gap-1 border-b">
      <RouterLink
        v-for="tab in tabs"
        :key="tab.label"
        v-slot="{ href, navigate, isActive }"
        :to="tab.to"
        custom
      >
        <a
          :href="href"
          :aria-current="isActive ? 'page' : undefined"
          class="px-3 py-2.5 text-sm no-underline"
          :class="
            isActive
              ? '-mb-px border-b-2 border-primary font-semibold text-foreground'
              : 'text-muted-foreground'
          "
          @click="navigate"
        >
          {{ tab.label }}
        </a>
      </RouterLink>
    </nav>
    <component :is="pages[String(route.name)]" />
  </div>
</template>

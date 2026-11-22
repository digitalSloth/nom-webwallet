<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useAccount, useWallet } from '@/core'
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  GiftIcon,
  LayoutDashboardIcon,
  SettingsIcon,
} from 'lucide-vue-next'

const TABS = [
  { name: 'home', label: 'Home', icon: LayoutDashboardIcon },
  { name: 'send', label: 'Send', icon: ArrowUpRightIcon },
  { name: 'receive', label: 'Receive', icon: ArrowDownLeftIcon },
  { name: 'rewards', label: 'Rewards', icon: GiftIcon },
  { name: 'settings', label: 'Settings', icon: SettingsIcon },
] as const

const route = useRoute()
const wallet = useWallet()
const { unreceivedCount } = useAccount(() => wallet.activeAccountAddress.value)
</script>

<template>
  <nav
    aria-label="Main"
    class="grid shrink-0 grid-cols-5 border-t bg-background px-1 pb-[env(safe-area-inset-bottom)]"
  >
    <RouterLink
      v-for="tab in TABS"
      :key="tab.name"
      v-slot="{ href, navigate }"
      :to="{ name: tab.name }"
      custom
    >
      <a
        :href="href"
        :aria-current="route.name === tab.name ? 'page' : undefined"
        class="relative flex h-14 flex-col items-center justify-center gap-[3px] text-[11px] no-underline"
        :class="
          route.name === tab.name
            ? 'font-semibold text-primary'
            : 'font-medium text-muted-foreground'
        "
        @click="navigate"
      >
        <component :is="tab.icon" class="size-5" aria-hidden="true" />
        <span>{{ tab.label }}</span>
        <template v-if="tab.name === 'receive' && unreceivedCount > 0">
          <span
            aria-hidden="true"
            class="absolute top-1.5 left-[calc(50%+6px)] h-4 min-w-4 rounded-full bg-info px-1 text-center text-[10px] leading-4 font-semibold text-background"
          >
            {{ unreceivedCount }}
          </span>
          <span class="sr-only">{{ unreceivedCount }} incoming</span>
        </template>
      </a>
    </RouterLink>
  </nav>
</template>

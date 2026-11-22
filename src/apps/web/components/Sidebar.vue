<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Badge, ZnnLogo } from 'nom-ui'
import { ChevronsUpDownIcon, LockIcon, SettingsIcon, ZapIcon } from 'lucide-vue-next'
import { networkLabel, urlHost } from '@/shared/lib/format'
import { isNavItemActive, navItems } from '../nav'
import { injectWebShell } from '../useWebShell'
import WalletSwitcher from './WalletSwitcher.vue'

// useAccount is not called here: each call adds an address watcher that reloads account data.
const { wallet, account, network } = injectWebShell()
const route = useRoute()

const groups = [
  { id: 'wallet', label: 'Wallet' },
  { id: 'network', label: 'Network' },
] as const

// The address tail is the part that tells accounts apart, so the label
// truncates and the tail always shows.
const activeAccount = computed(() => {
  const accounts = wallet.activeWallet.value?.accounts ?? []
  const found = accounts.find((a) => a.address === wallet.activeAccountAddress.value)
  if (!found) return null
  return { label: found.label || `Account ${found.index + 1}`, tail: found.address.slice(-5) }
})

const nodeHealthy = computed(() => network.isConnected.value && !network.nodeDown.value)

const plasmaClass = computed(() => {
  if (account.plasmaLevel.value === 'high') return 'text-success'
  if (account.plasmaLevel.value === 'medium') return 'text-info'
  return 'text-warning'
})
</script>

<template>
  <aside
    class="flex flex-col gap-[18px] border-r border-sidebar-border bg-sidebar px-4 py-5 text-foreground"
  >
    <div class="flex items-center gap-2.5 px-2">
      <ZnnLogo class="size-6" />
      <span class="text-base font-bold">NoM Wallet</span>
    </div>

    <WalletSwitcher>
      <button
        type="button"
        class="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-primary"
        >
          {{ (wallet.activeWallet.value?.name ?? '?').charAt(0).toUpperCase() }}
        </span>
        <span class="flex min-w-0 grow flex-col">
          <span class="truncate text-sm font-semibold">{{ wallet.activeWallet.value?.name }}</span>
          <span v-if="activeAccount" class="flex gap-1 text-xs text-muted-foreground">
            <span class="min-w-0 truncate">{{ activeAccount.label }}</span>
            <span class="shrink-0" aria-hidden="true">·</span>
            <span class="shrink-0 font-mono">…{{ activeAccount.tail }}</span>
          </span>
        </span>
        <ChevronsUpDownIcon class="size-4 shrink-0" aria-hidden="true" />
      </button>
    </WalletSwitcher>

    <nav aria-label="Wallet" class="flex flex-col gap-0.5">
      <template v-for="group in groups" :key="group.id">
        <span class="px-2.5 pt-3.5 pb-1 text-ledger text-muted-foreground">{{ group.label }}</span>
        <RouterLink
          v-for="item in navItems.filter((n) => n.group === group.id)"
          :key="item.label"
          v-slot="{ href, navigate }"
          :to="item.to"
          custom
        >
          <a
            :href="href"
            :aria-current="isNavItemActive(item, route.name) ? 'page' : undefined"
            class="flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline"
            :class="
              isNavItemActive(item, route.name) ? 'bg-sidebar-accent font-semibold' : 'font-normal'
            "
            @click="navigate"
          >
            <component
              :is="item.icon"
              class="size-[18px]"
              :class="isNavItemActive(item, route.name) ? 'text-primary' : ''"
              aria-hidden="true"
            />
            <span class="grow">{{ item.label }}</span>
            <Badge
              v-if="item.badge === 'unreceived' && account.unreceivedCount.value > 0"
              variant="pending"
            >
              {{ account.unreceivedCount.value }}
            </Badge>
          </a>
        </RouterLink>
      </template>
    </nav>

    <div class="flex-1" />

    <div class="flex flex-col rounded-lg border bg-card">
      <RouterLink
        :to="{ name: 'settings-network' }"
        class="flex flex-col gap-0.5 px-3 py-2.5 text-left"
      >
        <span class="flex items-center gap-1.5">
          <span
            class="size-1.5 rounded-full"
            :class="nodeHealthy ? 'bg-success' : 'bg-destructive'"
            aria-hidden="true"
          />
          <span
            class="grow text-ledger"
            :class="network.nodeDown.value ? 'text-destructive' : 'text-muted-foreground'"
          >
            <template v-if="network.nodeDown.value">Node unreachable</template>
            <template v-else>
              {{ networkLabel(network.chainId.value) }} ·
              {{ network.isConnected.value ? 'connected' : 'disconnected' }}
            </template>
          </span>
        </span>
        <span class="truncate font-mono text-xs text-muted-foreground">{{
          urlHost(network.currentNode.value)
        }}</span>
      </RouterLink>
      <RouterLink
        v-if="wallet.activeAccountAddress.value"
        :to="{ name: 'plasma' }"
        class="flex items-center gap-1.5 border-t px-3 py-2.5 text-ledger"
        :class="plasmaClass"
      >
        <ZapIcon class="size-3" aria-hidden="true" />
        <span>Plasma {{ account.plasmaLevel.value }}</span>
      </RouterLink>
    </div>

    <div class="grid grid-cols-2 gap-1.5">
      <RouterLink
        :to="{ name: 'settings-wallets' }"
        class="flex h-9 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium hover:bg-sidebar-accent"
      >
        <SettingsIcon class="size-4" aria-hidden="true" />
        Settings
      </RouterLink>
      <button
        type="button"
        class="flex h-9 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium hover:bg-sidebar-accent"
        @click="wallet.lockAllWallets()"
      >
        <LockIcon class="size-4" aria-hidden="true" />
        Lock
      </button>
    </div>
  </aside>
</template>

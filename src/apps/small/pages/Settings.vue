<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useRouter } from 'vue-router'
import { useAutoLock, useAutoReceiveSetting, useNetwork, useWallet } from '@/core'
import { Button, Switch, useTheme, useToast } from 'nom-ui'
import {
  ChevronRightIcon,
  GlobeIcon,
  LinkIcon,
  LockIcon,
  ShieldIcon,
  WalletIcon,
} from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import { injectSmallHost } from '@/apps/small/host'
import { urlHost } from '@/shared/lib/format'

const router = useRouter()
const wallet = useWallet()
const network = useNetwork()
const host = injectSmallHost()
const connections = host.useConnections()
const { minutes } = useAutoLock()
const { theme, setTheme } = useTheme()
const toast = useToast()
const autoReceive = useAutoReceiveSetting()
const savingAutoReceive = ref(false)

const walletsDetail = computed(() => {
  const count = wallet.wallets.value.length
  const name = wallet.activeWallet.value?.name ?? ''
  return `${count === 1 ? '1 wallet' : `${count} wallets`} · ${name} active`
})

const networkDetail = computed(
  () =>
    `${urlHost(network.currentNode.value)} · ${network.isConnected.value ? 'connected' : 'disconnected'}`
)

const rows = computed<{ label: string; detail: string; icon: Component; open: () => void }[]>(
  () => [
    {
      label: 'Wallets & accounts',
      detail: walletsDetail.value,
      icon: WalletIcon,
      open: () => void router.push({ name: 'settings-wallets' }),
    },
    {
      label: 'Network',
      detail: networkDetail.value,
      icon: GlobeIcon,
      open: () => void router.push({ name: 'settings-network' }),
    },
    {
      label: connections.label,
      detail: connections.detail.value,
      icon: LinkIcon,
      open: () => void router.push({ name: 'apps' }),
    },
    {
      label: 'Security',
      detail: `Auto-lock ${minutes.value} min · phrase and password per wallet`,
      icon: ShieldIcon,
      open: () => void router.push({ name: 'settings-security' }),
    },
  ]
)

const dark = computed(() => theme.value === 'dark')

async function onAutoReceiveChange(on: boolean): Promise<void> {
  if (savingAutoReceive.value) return
  savingAutoReceive.value = true
  try {
    await autoReceive.setEnabled(on)
  } catch {
    toast.show('Could not save the auto-receive setting.', 'error')
  } finally {
    savingAutoReceive.value = false
  }
}

function lockAll(): void {
  wallet.lockAllWallets()
  void router.push('/')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Settings" top-level />

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <ul class="divide-y rounded-lg border">
        <li v-for="row in rows" :key="row.label">
          <button
            type="button"
            class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted"
            @click="row.open()"
          >
            <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <component :is="row.icon" class="size-4" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ row.label }}</span>
              <span v-if="row.detail" class="block truncate text-xs text-muted-foreground">
                {{ row.detail }}
              </span>
            </span>
            <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
          </button>
        </li>
      </ul>

      <div class="space-y-2">
        <div class="text-ledger text-muted-foreground">Preferences</div>
        <div class="flex items-center justify-between rounded-lg border px-3 py-3">
          <label for="dark-theme" class="text-sm font-medium">Dark theme</label>
          <Switch
            id="dark-theme"
            :model-value="dark"
            @update:model-value="setTheme($event ? 'dark' : 'light')"
          />
        </div>
        <component :is="host.settingsExtras" v-if="host.settingsExtras" />
        <div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
          <label for="auto-receive">
            <span class="block text-sm font-medium">Auto-receive</span>
            <span class="block text-xs text-muted-foreground">
              Receive ZNN, QSR and tokens you hold while the wallet is open and unlocked
            </span>
          </label>
          <Switch
            id="auto-receive"
            :model-value="autoReceive.enabled.value"
            :disabled="savingAutoReceive"
            @update:model-value="onAutoReceiveChange($event === true)"
          />
        </div>
      </div>

      <p class="text-center text-xs text-muted-foreground">
        NoM Wallet {{ host.kind }} · v{{ host.appVersion }}
      </p>
    </div>

    <footer class="border-t px-4 py-3">
      <Button
        variant="outline"
        class="w-full"
        :disabled="wallet.unlockedWallets.value.length === 0"
        @click="lockAll"
      >
        <LockIcon /> Lock wallet
      </Button>
    </footer>
  </div>
</template>

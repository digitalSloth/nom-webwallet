<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Amount, Popover, PopoverContent, PopoverTrigger, useToast } from 'nom-ui'
import { useAccountBalances, useWallet } from '@/core'
import { shortAddress } from '@/shared/lib/format'

withDefaults(defineProps<{ side?: 'right' | 'bottom'; align?: 'start' | 'center' | 'end' }>(), {
  side: 'bottom',
  align: 'start',
})

const open = defineModel<boolean>('open', { default: false })

const wallet = useWallet()
const router = useRouter()
const toast = useToast()

const busy = ref(false)

const visibleAccounts = computed(() =>
  [...(wallet.activeWallet.value?.accounts ?? [])]
    .filter((a) => !a.hidden)
    .sort((a, b) => a.index - b.index)
)
const { balances, load } = useAccountBalances(() => visibleAccounts.value.map((a) => a.address))

watch(open, (isOpen) => {
  if (isOpen) void load()
})

function isUnlocked(baseAddress: string): boolean {
  return wallet.unlockedWallets.value.includes(baseAddress)
}

async function run(action: () => Promise<void>, close = true): Promise<void> {
  if (busy.value) return
  busy.value = true
  if (close) open.value = false
  try {
    await action()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Something went wrong', 'error')
  } finally {
    busy.value = false
  }
}

function selectWallet(baseAddress: string): Promise<void> {
  return run(async () => {
    if (baseAddress === wallet.activeWallet.value?.baseAddress) return
    await wallet.setActiveWallet(baseAddress)
  })
}

function selectAccount(address: string): Promise<void> {
  return run(async () => {
    if (address === wallet.activeAccountAddress.value) return
    await wallet.setActiveAccount(address)
  })
}

// The menu stays open so the new address shows in the list.
function addAddress(): Promise<void> {
  const active = wallet.activeWallet.value
  if (!active) return Promise.resolve()
  return run(async () => {
    await wallet.deriveAccount(active.baseAddress)
    await load()
  }, false)
}

function manageWallets(): void {
  open.value = false
  void router.push({ name: 'settings-wallets' })
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <PopoverContent
      :side="side"
      :align="align"
      :collision-padding="8"
      class="flex max-h-[var(--reka-popover-content-available-height)] w-[340px] max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-y-auto p-3.5"
      role="dialog"
      aria-label="Wallets and accounts"
    >
      <span class="text-ledger text-muted-foreground">Wallets</span>
      <div role="radiogroup" aria-label="Wallets" class="flex flex-col gap-1">
        <button
          v-for="w in wallet.wallets.value"
          :key="w.baseAddress"
          type="button"
          role="radio"
          :aria-checked="w.baseAddress === wallet.activeWallet.value?.baseAddress"
          class="flex min-h-11 items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-1.5 text-left hover:bg-muted"
          :class="{
            'border-border bg-muted': w.baseAddress === wallet.activeWallet.value?.baseAddress,
          }"
          :disabled="busy"
          @click="selectWallet(w.baseAddress)"
        >
          <span
            class="flex size-[26px] shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
          >
            {{ w.name.charAt(0).toUpperCase() }}
          </span>
          <span class="grow truncate text-sm font-semibold">{{ w.name }}</span>
          <span
            class="text-xs"
            :class="isUnlocked(w.baseAddress) ? 'text-success' : 'text-muted-foreground'"
          >
            {{ isUnlocked(w.baseAddress) ? 'Unlocked' : 'Locked' }}
          </span>
        </button>
      </div>

      <template v-if="wallet.activeWallet.value">
        <span class="text-ledger text-muted-foreground">
          Accounts · {{ wallet.activeWallet.value.name }}
        </span>
        <div
          role="radiogroup"
          aria-label="Accounts"
          class="flex flex-col divide-y overflow-hidden rounded-lg border"
        >
          <button
            v-for="a in visibleAccounts"
            :key="a.address"
            type="button"
            role="radio"
            :aria-checked="a.address === wallet.activeAccountAddress.value"
            class="flex min-h-12 items-center gap-2.5 px-3 py-1.5 text-left hover:bg-muted"
            :class="{ 'bg-muted': a.address === wallet.activeAccountAddress.value }"
            :disabled="busy"
            @click="selectAccount(a.address)"
          >
            <span class="flex min-w-0 grow flex-col">
              <span class="truncate text-[13px] font-semibold">{{ a.label }}</span>
              <span class="font-mono text-[11px] text-muted-foreground">
                {{ shortAddress(a.address) }}
              </span>
            </span>
            <Amount
              v-if="balances[a.address]"
              :value="balances[a.address].znn"
              :decimals="2"
              symbol="ZNN"
              class="shrink-0 text-xs"
            />
          </button>
        </div>
      </template>

      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="flex h-9 items-center justify-center rounded-md border text-[13px] font-medium hover:bg-muted disabled:opacity-50"
          :disabled="busy || !wallet.isActiveWalletUnlocked.value"
          @click="addAddress"
        >
          Add address
        </button>
        <button
          type="button"
          class="flex h-9 items-center justify-center rounded-md border text-[13px] font-medium hover:bg-muted"
          @click="manageWallets"
        >
          Manage wallets
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>

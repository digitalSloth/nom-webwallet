<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccountBalances, useWallet } from '@/core'
import { Amount, Button, useToast } from 'nom-ui'
import { CheckIcon, LockIcon, LockOpenIcon, PlusIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import { accountCountLabel, shortAddress } from '@/shared/lib/format'

const router = useRouter()
const wallet = useWallet()
const toast = useToast()

const busy = ref(false)

const visibleAccounts = computed(() =>
  [...(wallet.activeWallet.value?.accounts ?? [])]
    .filter((a) => !a.hidden)
    .sort((a, b) => a.index - b.index)
)
const { balances, load } = useAccountBalances(() => visibleAccounts.value.map((a) => a.address))

onMounted(() => void load())

function isUnlocked(baseAddress: string): boolean {
  return wallet.unlockedWallets.value.includes(baseAddress)
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Something went wrong', 'error')
  } finally {
    busy.value = false
  }
}

function selectWallet(baseAddress: string): Promise<void> {
  if (baseAddress === wallet.activeWallet.value?.baseAddress) return Promise.resolve()
  return run(async () => {
    await wallet.setActiveWallet(baseAddress)
    await router.push('/')
  })
}

function selectAccount(address: string): Promise<void> {
  return run(async () => {
    await wallet.setActiveAccount(address)
    await router.push('/')
  })
}

function addAccount(): Promise<void> {
  const active = wallet.activeWallet.value
  if (!active) return Promise.resolve()
  return run(async () => {
    await wallet.deriveAccount(active.baseAddress)
    void load()
  })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Wallets & accounts" @back="router.push('/')" />

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="space-y-2">
        <div class="text-ledger text-muted-foreground">Wallets</div>
        <div role="radiogroup" aria-label="Wallets" class="divide-y rounded-lg border">
          <button
            v-for="w in wallet.wallets.value"
            :key="w.baseAddress"
            type="button"
            role="radio"
            :aria-checked="w.baseAddress === wallet.activeWallet.value?.baseAddress"
            class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted"
            :class="{ 'bg-muted': w.baseAddress === wallet.activeWallet.value?.baseAddress }"
            :disabled="busy"
            @click="selectWallet(w.baseAddress)"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold"
            >
              {{ w.name.charAt(0).toUpperCase() }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ w.name }}</span>
              <span class="block text-xs text-muted-foreground">{{
                accountCountLabel(w.accounts)
              }}</span>
            </span>
            <span
              v-if="isUnlocked(w.baseAddress)"
              class="flex items-center gap-1 text-xs text-success"
            >
              <LockOpenIcon class="size-3.5" /> Unlocked
            </span>
            <span v-else class="flex items-center gap-1 text-xs text-muted-foreground">
              <LockIcon class="size-3.5" /> Locked
            </span>
          </button>
        </div>
      </div>

      <div v-if="wallet.activeWallet.value" class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-ledger text-muted-foreground">
            Accounts · {{ wallet.activeWallet.value.name }}
          </div>
          <div class="flex items-center gap-2">
            <span v-if="!wallet.isActiveWalletUnlocked.value" class="text-xs text-muted-foreground">
              Unlock to add accounts
            </span>
            <Button
              variant="ghost"
              size="xs"
              :disabled="busy || !wallet.isActiveWalletUnlocked.value"
              @click="addAccount"
            >
              <PlusIcon /> Add account
            </Button>
          </div>
        </div>
        <ul role="radiogroup" aria-label="Accounts" class="divide-y rounded-lg border">
          <li v-for="a in visibleAccounts" :key="a.address">
            <button
              type="button"
              role="radio"
              :aria-checked="a.address === wallet.activeAccountAddress.value"
              class="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-muted"
              :disabled="busy"
              @click="selectAccount(a.address)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ a.label }}</span>
                <span class="block font-mono text-xs text-muted-foreground">
                  {{ shortAddress(a.address) }}
                </span>
              </span>
              <span v-if="balances[a.address]" class="text-right text-xs">
                <Amount :value="balances[a.address].znn" :decimals="2" symbol="ZNN" class="block" />
                <Amount :value="balances[a.address].qsr" :decimals="2" symbol="QSR" class="block" />
              </span>
              <CheckIcon
                v-if="a.address === wallet.activeAccountAddress.value"
                class="size-4 shrink-0 text-success"
              />
            </button>
          </li>
        </ul>
        <p class="text-xs text-muted-foreground">
          Rename, hide accounts, export the phrase or remove a wallet in Manage wallet.
        </p>
      </div>
    </div>

    <footer class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <Button variant="outline" @click="router.push({ name: 'welcome' })">Add wallet</Button>
      <Button
        variant="outline"
        :disabled="!wallet.activeWallet.value"
        @click="
          router.push({
            name: 'manage-wallet',
            params: { address: wallet.activeWallet.value!.baseAddress },
          })
        "
      >
        Manage wallet
      </Button>
    </footer>
  </div>
</template>

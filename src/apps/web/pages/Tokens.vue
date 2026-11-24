<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onTxProgress, useOwnedTokens, useWallet } from '@/core'
import { Address, Alert, Badge, Button, Spinner, TokenIcon } from 'nom-ui'
import { PlusIcon, WalletIcon } from 'lucide-vue-next'
import TokenActionDialog from '../components/TokenActionDialog.vue'
import { ownedRow } from '../lib/owned-tokens'
import type { TokenActionMode } from '../lib/token-actions'

const wallet = useWallet()
const tokens = useOwnedTokens()
// WebLayout keys the page by the active account, so this snapshot stays correct.
const address = wallet.activeAccountAddress.value

const accountLabel = computed(() => {
  const a = wallet.activeWallet.value?.accounts.find((x) => x.address === address)
  return a ? a.label || `Account ${a.index + 1}` : 'Account'
})

function reload(): void {
  if (address) void tokens.loadOwned(address)
}

const stop = onTxProgress((tx) => {
  if (tx.address === address) reload()
})
onBeforeUnmount(stop)
onMounted(reload)

const action = ref<{ mode: TokenActionMode; tokenStandard: string | null } | null>(null)

const loaded = computed(() => tokens.ownedFor.value === address)
const rows = computed(() => (loaded.value ? tokens.owned.value.map(ownedRow) : []))
const count = computed(() =>
  tokens.ownedCountFor.value === address ? tokens.ownedCount.value : null
)
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div class="flex grow flex-col gap-1">
        <h1 class="text-3xl font-semibold tracking-tight">Tokens</h1>
        <p class="text-sm text-muted-foreground">
          ZTS tokens owned by {{ accountLabel }}. Issue a new token, or mint, burn and manage the
          ones you own.
        </p>
      </div>
      <Button as-child>
        <RouterLink :to="{ name: 'token-issue' }"><PlusIcon />Issue token</RouterLink>
      </Button>
    </div>

    <div v-if="!address" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <Alert
      v-else-if="!loaded && tokens.error.value"
      variant="destructive"
      class="flex flex-wrap items-center gap-3 text-sm"
    >
      <span>{{ tokens.error.value }}</span>
      <Button variant="outline" size="sm" :disabled="tokens.isLoading.value" @click="reload">
        Retry
      </Button>
    </Alert>

    <div v-else-if="!loaded" class="flex justify-center py-4"><Spinner /></div>

    <section
      v-else-if="rows.length === 0"
      class="flex flex-col items-center gap-2.5 rounded-xl border border-dashed px-6 py-12 text-center"
    >
      <span class="text-base font-semibold">You don't own any tokens</span>
      <span class="max-w-[420px] text-sm text-muted-foreground">
        Issue your own ZTS token with a fixed or mintable supply. Tokens you hold but don't own are
        on the
        <RouterLink :to="{ name: 'home' }" class="font-semibold underline">Dashboard</RouterLink>.
      </span>
      <Button as-child>
        <RouterLink :to="{ name: 'token-issue' }"><PlusIcon />Issue token</RouterLink>
      </Button>
    </section>

    <section v-else aria-labelledby="web-tokens-owned" class="rounded-xl border bg-card">
      <div class="flex items-center gap-3 border-b px-5 py-4">
        <h2 id="web-tokens-owned" class="grow text-base font-semibold">Owned by you</h2>
        <span v-if="count !== null" class="text-[13px] text-muted-foreground">
          <span class="font-mono">{{ count }}</span> {{ count === 1 ? 'token' : 'tokens' }}
        </span>
      </div>
      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr class="text-ledger text-muted-foreground">
              <th class="px-5 py-2.5 text-left font-medium">Token</th>
              <th class="px-3 py-2.5 text-left font-medium">Standard</th>
              <th class="px-3 py-2.5 text-right font-medium">Supply / max</th>
              <th class="px-5 py-2.5 text-left font-medium">Properties</th>
              <th class="px-5 py-2.5 text-right font-medium">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.zts" class="border-t">
              <td class="px-5 py-3.5">
                <RouterLink
                  :to="{ name: 'token', params: { tokenStandard: row.zts } }"
                  class="flex items-center gap-2.5 text-foreground no-underline"
                >
                  <TokenIcon :symbol="row.symbol" class="size-8" />
                  <span class="flex flex-col">
                    <span class="font-semibold">{{ row.symbol }}</span>
                    <span class="text-xs text-muted-foreground">{{ row.name }}</span>
                  </span>
                </RouterLink>
              </td>
              <td class="px-3 py-3.5">
                <Address :address="row.zts" :start="8" :end="4" copy />
              </td>
              <td class="px-3 py-3.5 text-right font-mono text-[13px] tabular-nums">
                {{ row.supply }}
                <span class="text-muted-foreground"> / {{ row.max }}</span>
              </td>
              <td class="px-5 py-3.5">
                <div class="flex flex-wrap gap-1.5">
                  <Badge
                    v-for="flag in row.flags"
                    :key="flag.label"
                    :variant="flag.on ? 'success' : 'outline'"
                    >{{ flag.label }}</Badge
                  >
                </div>
              </td>
              <td class="px-5 py-3.5">
                <div class="flex justify-end gap-1.5">
                  <Button
                    v-if="row.canMint"
                    variant="outline"
                    size="sm"
                    @click="action = { mode: 'mint', tokenStandard: row.zts }"
                  >
                    Mint
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    @click="action = { mode: 'burn', tokenStandard: row.zts }"
                  >
                    Burn
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    @click="action = { mode: 'manage', tokenStandard: row.zts }"
                  >
                    Manage
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section
      v-if="address"
      aria-labelledby="web-tokens-burn"
      class="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-5 py-4"
    >
      <span class="flex flex-[1_1_320px] flex-col gap-0.5">
        <h2 id="web-tokens-burn" class="text-[15px] font-semibold">Burn a token you hold</h2>
        <span class="text-[13px] text-muted-foreground">
          Burnable tokens can be burned by any holder, not just the owner.
        </span>
      </span>
      <Button variant="outline" @click="action = { mode: 'burn', tokenStandard: null }">
        Burn tokens
      </Button>
    </section>

    <TokenActionDialog
      v-if="action"
      :mode="action.mode"
      :token-standard="action.tokenStandard"
      @close="action = null"
    />
  </div>
</template>

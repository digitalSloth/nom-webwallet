<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { addNumberDecimals } from 'znn-typescript-sdk'
import { useAccount, useActivityPages, useIncoming, useNetwork, useWallet } from '@/core'
import { NODE_RETRY_MS } from '@/config'
import { Address, Alert, Amount, Badge, Button, Input, TokenIcon } from 'nom-ui'
import { LandmarkIcon, WalletIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { urlHost } from '@/shared/lib/format'
import { plasmaPercent } from '@/shared/lib/plasma'
import ActivityTable from '../components/ActivityTable.vue'
import { tokenRows } from '../lib/token-rows'

const INCOMING_SHOWN = 5
const ACTIVITY_SHOWN = 5

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const network = useNetwork()
const incoming = useIncoming({
  address: active,
  account,
  onLocked: () => wallet.refreshLockState(),
})
const { blocks, busy, error, bulkFailure } = incoming
const pages = useActivityPages(active)

const query = ref('')
const tokens = computed(() => tokenRows(account.balances.value, query.value))
const shownBlocks = computed(() => blocks.value.slice(0, INCOMING_SHOWN))

const LEVELS = {
  low: { label: 'Low', class: 'text-warning' },
  medium: { label: 'Medium', class: 'text-info' },
  high: { label: 'High', class: 'text-success' },
} as const

const level = computed(() => LEVELS[account.plasmaLevel.value])
const percent = computed(() => plasmaPercent(account.currentPlasma.value, account.maxPlasma.value))
const hasRewards = computed(
  () => Number(account.totalZnnRewards.value) > 0 || Number(account.totalQsrRewards.value) > 0
)

onMounted(() => {
  void incoming.loadFirstPage()
  void pages.load(0)
})

watch(account.accountHeight, () => void pages.load(0))
watch(account.unreceivedCount, () => void incoming.loadFirstPage())

// The lock check runs here as well as in useIncoming, which only reads the state it is given.
function ready(): boolean {
  wallet.refreshLockState()
  return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
}

async function openTracker(hash: string | null): Promise<void> {
  if (hash) await router.replace({ name: 'tx', params: { hash } })
}

async function receiveAll(): Promise<void> {
  if (!ready()) return
  await openTracker(await incoming.receiveAll())
}

async function retryAll(): Promise<void> {
  if (!ready()) return
  await openTracker(await incoming.retryAll())
}

function amountText(raw: string, decimals: number): string {
  return formatAmount(BigInt(raw), decimals)
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div v-if="!active()" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <div
        v-if="network.nodeDown.value"
        role="alert"
        class="flex flex-wrap items-center gap-3 rounded-lg border border-destructive px-4 py-3 text-sm"
      >
        <span class="grow">
          Can't reach {{ urlHost(network.currentNode.value) }}. Balances may be out of date and
          sending is paused. Retrying every {{ NODE_RETRY_MS / 1000 }} seconds.
        </span>
        <RouterLink :to="{ name: 'settings-network' }" class="font-medium no-underline">
          Change node
        </RouterLink>
      </div>

      <div
        v-if="account.isNewAccount.value"
        class="flex flex-wrap items-center gap-4 rounded-xl border border-primary bg-accent px-6 py-5"
      >
        <span class="flex flex-[1_1_320px] flex-col gap-1">
          <span class="text-base font-semibold">Your wallet is ready</span>
          <span class="text-sm text-muted-foreground">
            Send ZNN or QSR to your address to get started. Get free plasma first so your first
            transactions don't need PoW.
          </span>
        </span>
        <Button @click="router.push({ name: 'receive' })">Show my address</Button>
        <Button variant="outline" @click="router.push({ name: 'plasma' })">Get free plasma</Button>
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <h1 class="grow text-3xl font-semibold tracking-tight">Dashboard</h1>
        <Address :address="active()!" :start="8" :end="6" copy class="text-[13px]" />
        <Badge variant="success">Unlocked</Badge>
      </div>

      <section
        aria-label="Balances"
        class="@container flex flex-wrap items-stretch gap-6 rounded-xl border bg-card p-6 shadow-md"
      >
        <div class="flex flex-[1_1_240px] flex-col gap-2">
          <span class="flex items-center gap-2">
            <TokenIcon symbol="ZNN" class="size-5" />
            <span class="text-ledger text-muted-foreground">ZNN balance</span>
          </span>
          <Amount
            :value="account.znnBalance.value"
            :decimals="8"
            dim-trailing-zeros
            class="text-[length:clamp(1rem,4cqi,1.875rem)] leading-[1.2] font-semibold whitespace-nowrap"
          />
        </div>
        <div
          class="flex flex-[1_1_240px] flex-col gap-2 border-t pt-4 @min-[504px]:border-t-0 @min-[504px]:border-l @min-[504px]:pt-0 @min-[504px]:pl-6"
        >
          <span class="flex items-center gap-2">
            <TokenIcon symbol="QSR" class="size-5" />
            <span class="text-ledger text-muted-foreground">QSR balance</span>
          </span>
          <Amount
            :value="account.qsrBalance.value"
            :decimals="8"
            dim-trailing-zeros
            class="text-[length:clamp(1rem,4cqi,1.875rem)] leading-[1.2] font-semibold whitespace-nowrap"
          />
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="lg"
            :disabled="network.nodeDown.value || account.isNewAccount.value"
            @click="router.push({ name: 'send' })"
          >
            Send
          </Button>
          <Button variant="outline" size="lg" @click="router.push({ name: 'receive' })">
            Receive
          </Button>
        </div>
      </section>

      <section
        aria-label="Account overview"
        class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3"
      >
        <div class="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <span class="text-ledger text-muted-foreground">Account height</span>
          <span class="font-mono text-xl font-semibold tabular-nums">
            {{ account.accountHeight.value.toLocaleString('en-US') }}
          </span>
          <span class="text-xs text-muted-foreground">
            {{ account.tokenCount.value }}
            {{ account.tokenCount.value === 1 ? 'token held' : 'tokens held' }}
          </span>
        </div>

        <div class="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <span class="flex justify-between">
            <span class="text-ledger text-muted-foreground">Plasma</span>
            <span :class="['text-xs font-semibold', level.class]">{{ level.label }}</span>
          </span>
          <span
            role="img"
            :aria-label="`Plasma ${percent} percent`"
            class="block h-2 overflow-hidden rounded-full bg-muted"
          >
            <span class="block h-full bg-plasma" :style="{ width: `${percent}%` }" />
          </span>
          <span class="text-xs text-muted-foreground">
            <span class="font-mono tabular-nums">{{
              formatAmount(BigInt(account.fusedQsr.value), 8)
            }}</span>
            QSR fused
          </span>
        </div>

        <div class="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <span class="text-ledger text-muted-foreground">Delegated pillar</span>
          <span class="flex items-center gap-2 text-base font-semibold">
            <template v-if="account.delegatedPillar.value">
              <LandmarkIcon class="size-[18px] text-primary" aria-hidden="true" />
              {{ account.delegatedPillar.value }}
            </template>
            <template v-else>Not delegating</template>
          </span>
          <RouterLink :to="{ name: 'pillars' }" class="text-xs no-underline">
            {{ account.delegatedPillar.value ? 'Change delegation' : 'Delegate' }}
          </RouterLink>
        </div>

        <div class="flex flex-col gap-2 rounded-xl border bg-card p-4">
          <span class="flex items-center justify-between">
            <span class="text-ledger text-muted-foreground">Uncollected rewards</span>
            <Badge v-if="hasRewards" variant="highlight">New</Badge>
          </span>
          <Amount
            :value="account.totalZnnRewards.value"
            :decimals="4"
            symbol="ZNN"
            class="text-[15px] font-semibold"
          />
          <Amount
            :value="account.totalQsrRewards.value"
            :decimals="4"
            symbol="QSR"
            class="text-[15px] font-semibold"
          />
          <RouterLink :to="{ name: 'rewards' }" class="text-xs no-underline">
            Collect rewards
          </RouterLink>
        </div>
      </section>

      <div class="flex flex-wrap items-start gap-5">
        <section
          aria-labelledby="web-dashboard-tokens"
          class="min-w-0 flex-[2_1_520px] rounded-xl border bg-card"
        >
          <div class="flex items-center gap-3 border-b px-5 py-4">
            <h2 id="web-dashboard-tokens" class="grow text-base font-semibold">Tokens</h2>
            <label for="web-dashboard-token-search" class="sr-only">Search tokens</label>
            <Input
              id="web-dashboard-token-search"
              v-model="query"
              placeholder="Search tokens"
              class="w-[200px]"
            />
          </div>
          <p v-if="tokens.length === 0" class="px-5 py-6 text-sm text-muted-foreground">
            {{ query.trim() === '' ? 'No tokens yet' : 'No matching tokens' }}
          </p>
          <div v-else class="relative overflow-x-auto">
            <table class="w-full border-collapse text-sm">
              <thead>
                <tr class="text-ledger text-muted-foreground">
                  <th class="px-5 py-2.5 text-left font-medium">Token</th>
                  <th class="px-3 py-2.5 text-left font-medium">ZTS</th>
                  <th class="px-5 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in tokens" :key="t.tokenStandard" class="border-t">
                  <td class="px-5 py-3">
                    <span class="flex items-center gap-3">
                      <TokenIcon :symbol="t.symbol ?? '?'" class="size-8" />
                      <span class="flex flex-col">
                        <RouterLink
                          :to="{ name: 'token', params: { tokenStandard: t.tokenStandard } }"
                          class="font-semibold text-foreground no-underline"
                        >
                          {{ t.symbol }}
                        </RouterLink>
                        <span class="text-xs text-muted-foreground">{{ t.name }}</span>
                      </span>
                    </span>
                  </td>
                  <td class="px-3 py-3 text-xs">
                    <Address :address="t.tokenStandard" :start="7" :end="4" :copy="false" />
                  </td>
                  <td class="px-5 py-3 text-right">
                    <Amount
                      :value="addNumberDecimals(t.balance, t.decimals)"
                      :decimals="t.decimals"
                      dim-trailing-zeros
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          aria-labelledby="web-dashboard-incoming"
          class="flex min-w-0 flex-[1_1_300px] flex-col rounded-xl border bg-card"
        >
          <div class="flex items-center gap-2 border-b px-5 py-4">
            <h2 id="web-dashboard-incoming" class="grow text-base font-semibold">Incoming</h2>
            <Badge v-if="account.unreceivedCount.value > 0" variant="pending">
              {{ account.unreceivedCount.value }} to receive
            </Badge>
          </div>
          <p v-if="blocks.length === 0" class="px-5 py-6 text-sm text-muted-foreground">
            Nothing waiting to receive.
          </p>
          <ul v-else class="m-0 flex list-none flex-col px-5 py-2">
            <li
              v-for="block in shownBlocks"
              :key="block.hash.toString()"
              class="flex items-center gap-3 py-2.5"
            >
              <TokenIcon :symbol="block.token?.symbol ?? '?'" class="size-6" />
              <span class="flex min-w-0 grow flex-col">
                <Amount
                  :value="amountText(block.amount.toString(), block.token?.decimals ?? 0)"
                  :decimals="block.token?.decimals ?? 0"
                  :symbol="block.token?.symbol ?? 'Unknown'"
                  class="text-sm font-semibold"
                />
                <span class="text-xs text-muted-foreground">
                  from
                  <Address :address="block.address.toString()" :start="6" :end="4" :copy="false" />
                </span>
              </span>
            </li>
          </ul>
          <div v-if="blocks.length > 0" class="px-5 pb-5">
            <Button variant="outline" class="w-full" :disabled="busy" @click="receiveAll">
              Receive all {{ blocks.length }}
            </Button>
          </div>
          <div v-if="error || bulkFailure" class="space-y-2 border-t px-5 py-3">
            <Alert v-if="error" variant="destructive" class="text-sm">{{ error }}</Alert>
            <Alert v-if="bulkFailure" variant="destructive" class="space-y-2 text-sm">
              <p>{{ bulkFailure }}</p>
              <Button variant="outline" size="sm" :disabled="busy" @click="retryAll">
                Try again
              </Button>
            </Alert>
          </div>
        </section>
      </div>

      <section aria-labelledby="web-dashboard-activity" class="rounded-xl border bg-card">
        <div class="flex items-center gap-3 border-b px-5 py-4">
          <h2 id="web-dashboard-activity" class="grow text-base font-semibold">Recent activity</h2>
          <RouterLink :to="{ name: 'activity' }" class="text-[13px] no-underline">
            View all
          </RouterLink>
        </div>
        <ActivityTable
          :rows="pages.rows.value.slice(0, ACTIVITY_SHOWN)"
          :is-loading="pages.isLoading.value"
          :error="pages.error.value"
          @retry="pages.load(0)"
        />
      </section>
    </template>
  </div>
</template>

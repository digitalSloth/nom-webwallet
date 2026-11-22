<script setup lang="ts">
import { computed } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import {
  REWARD_SOURCE_LABELS,
  useNetwork,
  usePillar,
  useRewards,
  useStake,
  useWallet,
} from '@/core'
import { Alert, Amount, Button, Spinner, TokenIcon } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { shortAddress, urlHost } from '@/shared/lib/format'
import { useRewardCollect } from '@/shared/lib/reward-collect'
import { trackUnresolvedSend } from '@/shared/lib/unresolved-send'
import { leaveAllowed } from '../routes'
import PageHeader from '../components/PageHeader.vue'
import RewardsChart from '../components/RewardsChart.vue'

const wallet = useWallet()
const rewards = useRewards()
const pillar = usePillar()
const stake = useStake()
const network = useNetwork()
const address = wallet.activeAccountAddress.value

const {
  loaded,
  rows,
  totals,
  collectable,
  submitting,
  failure,
  retryable,
  delegationLoaded,
  isCollecting,
  detail,
  load,
  collectOne,
  collectAll,
  tryAgain,
} = useRewardCollect({ address, wallet, rewards, pillar, stake })
trackUnresolvedSend(submitting)
onBeforeRouteLeave((to) => leaveAllowed(submitting.value, to))

const accountLabel = computed(
  () => wallet.activeWallet.value?.accounts.find((a) => a.address === address)?.label ?? 'Account'
)
const loadError = computed(
  () => !loaded.value && !rewards.isLoading.value && rewards.error.value !== null
)
const labelOf = (type: keyof typeof REWARD_SOURCE_LABELS) =>
  REWARD_SOURCE_LABELS[type].toLowerCase()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Rewards" top-level>
      <span v-if="address" class="font-mono text-xs text-muted-foreground tabular-nums">
        {{ accountLabel }} · {{ shortAddress(address) }}
      </span>
    </PageHeader>

    <div v-if="!address" class="flex-1 py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">
      <div
        v-if="network.nodeDown.value"
        role="alert"
        class="flex items-center gap-2 rounded-lg border border-destructive px-3 py-2.5 text-xs"
      >
        <span class="flex-1">
          Can't reach {{ urlHost(network.currentNode.value) }}. Rewards may be out of date and
          collecting is paused.
        </span>
        <RouterLink
          :to="{ name: 'settings-network' }"
          class="font-medium whitespace-nowrap text-info"
        >
          Change node
        </RouterLink>
      </div>

      <template v-if="!loaded">
        <div v-if="loadError" class="flex flex-col items-start gap-2">
          <p class="text-sm text-muted-foreground">Couldn't load rewards from the node.</p>
          <Button variant="outline" size="sm" @click="load()">Try again</Button>
        </div>
        <div v-else class="flex justify-center py-6">
          <Spinner />
        </div>
      </template>

      <section v-else aria-label="Uncollected rewards" class="flex flex-col gap-3">
        <div class="text-ledger text-muted-foreground">Uncollected</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <span class="flex items-center gap-1.5">
              <TokenIcon symbol="ZNN" class="size-4" />
              <span class="text-ledger text-muted-foreground">ZNN</span>
            </span>
            <Amount
              :value="formatAmount(totals.znn, 8)"
              :decimals="4"
              class="text-[22px] font-semibold"
            />
          </div>
          <div class="flex flex-col gap-1">
            <span class="flex items-center gap-1.5">
              <TokenIcon symbol="QSR" class="size-4" />
              <span class="text-ledger text-muted-foreground">QSR</span>
            </span>
            <Amount
              :value="formatAmount(totals.qsr, 8)"
              :decimals="2"
              class="text-[22px] font-semibold"
            />
          </div>
        </div>
        <Button
          size="lg"
          class="w-full"
          :disabled="collectable.length === 0 || submitting || network.nodeDown.value"
          @click="collectAll()"
        >
          <template v-if="submitting"><Spinner /> Collecting…</template>
          <template v-else>Collect all</template>
        </Button>
        <p class="text-xs text-muted-foreground">
          <template v-if="collectable.length > 0">
            One transaction per source ·
            <span class="font-mono">{{ collectable.length }}</span
            >. With low plasma each needs PoW.
          </template>
          <template v-else>Nothing to collect right now.</template>
        </p>
      </section>

      <Alert v-if="failure" variant="destructive" class="flex flex-wrap items-center gap-3 text-sm">
        <span>{{ failure.message }}</span>
        <RouterLink
          v-if="failure.timeout"
          :to="{ name: 'home', query: { tab: 'activity' } }"
          class="font-semibold underline"
        >
          Check activity
        </RouterLink>
        <Button
          v-else-if="retryable"
          size="sm"
          variant="outline"
          :disabled="submitting"
          @click="tryAgain()"
        >
          Try again
        </Button>
      </Alert>

      <section v-if="loaded" aria-labelledby="small-rewards-sources" class="flex flex-col gap-1">
        <h2 id="small-rewards-sources" class="text-ledger font-medium text-muted-foreground">
          By source
        </h2>
        <ul>
          <li
            v-for="row in rows"
            :key="row.type"
            class="flex min-h-12 items-center gap-2.5 border-b py-1.5"
            :class="{ 'opacity-60': !row.has }"
          >
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="text-[13px] font-semibold">{{ REWARD_SOURCE_LABELS[row.type] }}</span>
              <span class="text-[11px] text-muted-foreground">{{ detail(row.type) }}</span>
            </div>
            <div class="flex flex-col items-end text-[13px]">
              <Amount
                v-if="row.znn > 0n"
                :value="formatAmount(row.znn, 8)"
                :decimals="4"
                symbol="ZNN"
              />
              <Amount
                v-if="row.qsr > 0n"
                :value="formatAmount(row.qsr, 8)"
                :decimals="4"
                symbol="QSR"
              />
              <span v-if="!row.has" class="text-muted-foreground">—</span>
            </div>
            <Button
              v-if="row.has"
              variant="outline"
              size="sm"
              :aria-label="`Collect ${labelOf(row.type)} rewards`"
              :disabled="submitting || isCollecting(row.type) || network.nodeDown.value"
              @click="collectOne(row.type)"
            >
              {{ isCollecting(row.type) ? 'Collecting…' : 'Collect' }}
            </Button>
          </li>
        </ul>
      </section>

      <RewardsChart v-if="rewards.historyFor.value === address" :history="rewards.history.value" />
      <div v-else-if="rewards.isLoadingHistory.value" class="flex justify-center py-4">
        <Spinner />
      </div>
      <p v-else-if="rewards.historyError.value" class="text-sm text-muted-foreground">
        {{ rewards.historyError.value }}
      </p>

      <div class="flex flex-col border-t pt-2.5 text-[13px]">
        <span class="text-ledger text-muted-foreground">Delegation</span>
        <span v-if="delegationLoaded" class="font-semibold">
          {{ pillar.delegation.value?.name ?? 'Not delegating' }}
        </span>
        <Spinner v-else />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { REWARD_SOURCE_LABELS, usePillar, useRewards, useStake, useWallet } from '@/core'
import type { RewardType } from '@/core'
import { Alert, Amount, Button, Spinner } from 'nom-ui'
import { DropletIcon, LandmarkIcon, LayersIcon, ShieldIcon, WalletIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import RewardsChart from '../components/RewardsChart.vue'
import { useRewardCollect } from '@/shared/lib/reward-collect'
import { trackUnresolvedSend } from '@/shared/lib/unresolved-send'

const ICONS = {
  pillar: LandmarkIcon,
  stake: LayersIcon,
  sentinel: ShieldIcon,
  liquidity: DropletIcon,
} as const

const wallet = useWallet()
const rewards = useRewards()
const pillar = usePillar()
const stake = useStake()
const active = () => wallet.activeAccountAddress.value

const accountLabel = computed(() => {
  const a = wallet.activeWallet.value?.accounts.find((x) => x.address === active())
  return a ? a.label || `Account ${a.index + 1}` : 'Account'
})

const address = active()
const {
  loaded,
  rows,
  totals,
  collectable,
  submitting,
  failure,
  retryable,
  delegationLoaded,
  stakesLoaded,
  delegationText,
  isCollecting,
  detail,
  collectOne,
  collectAll,
  tryAgain,
} = useRewardCollect({ address, wallet, rewards, pillar, stake })
trackUnresolvedSend(submitting)
onBeforeRouteLeave(() => !submitting.value)
const labelOf = (type: RewardType) => REWARD_SOURCE_LABELS[type].toLowerCase()

const stakeSum = computed(() =>
  stake.stakeEntries.value.reduce((sum, e) => sum + BigInt(e.amount.toString()), 0n)
)
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Rewards</h1>
      <p class="text-sm text-muted-foreground">
        Rewards build up in the embedded contracts until you collect them to {{ accountLabel }}.
      </p>
    </div>

    <div v-if="!address" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <section
        aria-label="Uncollected rewards"
        class="@container flex flex-wrap items-center gap-6 rounded-xl border bg-card p-6 shadow-md"
      >
        <div class="flex flex-[1_1_200px] flex-col gap-2">
          <span class="text-ledger text-muted-foreground">Uncollected ZNN</span>
          <Amount
            v-if="loaded"
            :value="formatAmount(totals.znn, 8)"
            :decimals="8"
            class="text-[length:clamp(1rem,4cqi,1.875rem)] leading-[1.2] font-semibold whitespace-nowrap"
          />
          <Spinner v-else />
        </div>
        <div
          class="flex flex-[1_1_200px] flex-col gap-2 border-t pt-4 @min-[424px]:border-t-0 @min-[424px]:border-l @min-[424px]:pt-0 @min-[424px]:pl-6"
        >
          <span class="text-ledger text-muted-foreground">Uncollected QSR</span>
          <Amount
            v-if="loaded"
            :value="formatAmount(totals.qsr, 8)"
            :decimals="8"
            class="text-[length:clamp(1rem,4cqi,1.875rem)] leading-[1.2] font-semibold whitespace-nowrap"
          />
          <Spinner v-else />
        </div>
        <div class="flex flex-col gap-1.5">
          <Button size="lg" :disabled="collectable.length === 0 || submitting" @click="collectAll">
            <template v-if="submitting"><Spinner /> Collecting…</template>
            <template v-else>Collect all</template>
          </Button>
          <span class="text-xs text-muted-foreground">
            One transaction per source · <span class="font-mono">{{ collectable.length }}</span>
          </span>
        </div>
      </section>

      <Alert v-if="failure" variant="destructive" class="flex flex-wrap items-center gap-3 text-sm">
        <span>{{ failure.message }}</span>
        <RouterLink
          v-if="failure.timeout"
          :to="{ name: 'activity' }"
          class="font-semibold underline"
          >Check activity</RouterLink
        >
        <Button
          v-else-if="retryable"
          size="sm"
          variant="outline"
          :disabled="submitting"
          @click="tryAgain"
        >
          Try again
        </Button>
      </Alert>

      <RewardsChart
        v-if="rewards.historyFor.value === address"
        :history="rewards.history.value"
        :genesis-at="rewards.genesisAt.value"
      />
      <div v-else-if="rewards.isLoadingHistory.value" class="flex justify-center py-4">
        <Spinner />
      </div>
      <p v-else-if="rewards.historyError.value" class="text-sm text-muted-foreground">
        {{ rewards.historyError.value }}
      </p>

      <section aria-labelledby="web-rewards-sources" class="rounded-xl border bg-card">
        <h2 id="web-rewards-sources" class="border-b px-5 py-4 text-base font-semibold">
          By source
        </h2>
        <div class="relative overflow-x-auto">
          <table class="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr class="text-ledger text-muted-foreground">
                <th class="px-5 py-2.5 text-left font-medium">Source</th>
                <th class="px-3 py-2.5 text-right font-medium">ZNN</th>
                <th class="px-3 py-2.5 text-right font-medium">QSR</th>
                <th class="px-5 py-2.5"><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.type"
                class="border-t"
                :style="{ opacity: loaded && !row.has ? 0.6 : 1 }"
              >
                <td class="px-5 py-3.5">
                  <span class="flex items-center gap-2.5">
                    <span
                      class="flex size-8 items-center justify-center rounded-md bg-muted text-primary"
                    >
                      <component :is="ICONS[row.type]" class="size-[18px]" aria-hidden="true" />
                    </span>
                    <span class="flex flex-col">
                      <span class="font-semibold">{{ REWARD_SOURCE_LABELS[row.type] }}</span>
                      <span class="text-xs text-muted-foreground">{{ detail(row.type) }}</span>
                    </span>
                  </span>
                </td>
                <td class="px-3 py-3.5 text-right">
                  <Amount :value="formatAmount(row.znn, 8)" :decimals="4" />
                </td>
                <td class="px-3 py-3.5 text-right">
                  <Amount :value="formatAmount(row.qsr, 8)" :decimals="4" />
                </td>
                <td class="px-5 py-3.5 text-right">
                  <Button
                    v-if="loaded && row.has"
                    variant="outline"
                    size="sm"
                    :aria-label="`Collect ${labelOf(row.type)} rewards`"
                    :disabled="submitting || isCollecting(row.type)"
                    @click="collectOne(row.type)"
                  >
                    {{ isCollecting(row.type) ? 'Collecting…' : 'Collect' }}
                  </Button>
                  <span v-else-if="loaded" class="text-[13px] text-muted-foreground">
                    Nothing to collect
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="border-t px-5 py-3.5 text-xs text-muted-foreground">
          Collecting is a contract call. With low plasma each one needs PoW and blocks the page
          until it's sent.
        </p>
      </section>

      <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
        <RouterLink
          :to="{ name: 'pillars' }"
          class="flex flex-col gap-1 rounded-xl border bg-card p-4 text-foreground no-underline"
        >
          <span class="text-ledger text-muted-foreground">Delegation</span>
          <span class="text-[15px] font-semibold">
            <template v-if="delegationLoaded">{{ delegationText }}</template>
            <Spinner v-else />
          </span>
          <span class="text-[13px] text-info">Manage delegation</span>
        </RouterLink>
        <RouterLink
          :to="{ name: 'staking' }"
          class="flex flex-col gap-1 rounded-xl border bg-card p-4 text-foreground no-underline"
        >
          <span class="text-ledger text-muted-foreground">Staking</span>
          <span class="text-[15px] font-semibold">
            <template v-if="stakesLoaded">
              <span class="font-mono">{{ stake.stakeEntries.value.length }}</span> active
              {{ stake.stakeEntries.value.length === 1 ? 'stake' : 'stakes' }} ·
              <span class="font-mono">{{ formatAmount(stakeSum, 8) }}</span> ZNN
            </template>
            <Spinner v-else />
          </span>
          <span class="text-[13px] text-info">Manage stakes</span>
        </RouterLink>
      </div>
    </template>
  </div>
</template>

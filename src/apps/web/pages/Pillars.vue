<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { collectMeta, onTxProgress, usePillar, useRewards, useWallet } from '@/core'
import type { PillarWithApr } from '@/core'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import {
  Address,
  Alert,
  Amount,
  Badge,
  Button,
  Input,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from 'nom-ui'
import { LandmarkIcon, WalletIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { explorerAccountUrl } from '@/shared/lib/format'
import { isPending, runPending } from '@/shared/lib/pending-calls'
import { delegationKey, sendDelegation } from '../lib/delegation'

const wallet = useWallet()
const pillar = usePillar()
const rewards = useRewards()
const active = () => wallet.activeAccountAddress.value

const address = active()
const submitting = ref(false)
const actionError = ref<{ message: string; timeout: boolean } | null>(null)
const query = ref('')
const sort = ref<'apr' | 'rank'>('apr')

const pendingKey = delegationKey(address)
const collectKey = `collect:${address}:pillar`

const UNDELEGATE_META = {
  kind: 'contract',
  title: 'Pillars · Undelegate',
  progress: 'Undelegating',
} as const

function reload(): void {
  if (!address) return
  void pillar.loadDelegation(address)
  void rewards.loadRewards(address)
}

const stop = onTxProgress((tx) => {
  if (tx.address === address) reload()
})
onBeforeUnmount(stop)
onBeforeRouteLeave(() => !submitting.value)

onMounted(() => {
  if (!address) return
  void pillar.loadPillars()
  reload()
})

const delegationLoaded = computed(() => pillar.delegationFor.value === address)
const rewardsLoaded = computed(() => rewards.rewardsFor.value === address)
const delegation = computed(() => (delegationLoaded.value ? pillar.delegation.value : null))

const delegatedApr = computed(() => {
  const match = pillar.pillars.value.find((p) => p.name === delegation.value?.name)
  return match ? `${match.delegateApr.toFixed(2)}%` : '—'
})

const pillarReward = computed(() => {
  const entry = rewards.rewards.value.find((r) => r.type === 'pillar')
  return {
    znn: BigInt(entry?.reward.znnAmount ?? 0n),
    qsr: BigInt(entry?.reward.qsrAmount ?? 0n),
  }
})
const canCollect = computed(
  () => (pillarReward.value.znn > 0n || pillarReward.value.qsr > 0n) && !isPending(collectKey)
)

const visible = computed<PillarWithApr[]>(() => {
  const q = query.value.trim().toLowerCase()
  const list = pillar.pillars.value.filter(
    (p) =>
      q === '' ||
      p.name.toLowerCase().includes(q) ||
      p.ownerAddress.toString().toLowerCase().includes(q)
  )
  return list.sort((a, b) =>
    sort.value === 'rank' ? a.rank - b.rank : b.delegateApr - a.delegateApr || a.rank - b.rank
  )
})

function setSort(value: string | number): void {
  sort.value = value === 'rank' ? 'rank' : 'apr'
}

// Locked wallets show the locked overlay; the check re-reads the session first.
function unlocked(): boolean {
  wallet.refreshLockState()
  return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
}

function setError(message: string): void {
  actionError.value = { message, timeout: message.includes(SEND_TIMEOUT_MESSAGE) }
}

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

async function undelegate(): Promise<void> {
  const from = active()
  const activeWallet = wallet.activeWallet.value
  if (!from || !activeWallet || pillar.delegationFor.value !== from) return
  if (!unlocked()) return
  if (submitting.value) return
  actionError.value = null
  submitting.value = true
  try {
    await runPending(delegationKey(from), () =>
      pillar.undelegate(activeWallet, from, UNDELEGATE_META)
    )
  } catch (err) {
    setError(`Couldn't undelegate: ${errorText(err, 'Failed to undelegate')}`)
  } finally {
    submitting.value = false
  }
}

async function delegate(p: PillarWithApr): Promise<void> {
  const from = active()
  const activeWallet = wallet.activeWallet.value
  if (!from || !activeWallet || pillar.delegationFor.value !== from) return
  if (!unlocked()) return
  if (submitting.value) return
  actionError.value = null
  submitting.value = true
  try {
    await sendDelegation(pillar.delegateToPillar, activeWallet, from, p.name)
  } catch (err) {
    setError(`Couldn't delegate to ${p.name}: ${errorText(err, 'Failed to delegate to pillar')}`)
  } finally {
    submitting.value = false
  }
}

async function collect(): Promise<void> {
  const from = active()
  const activeWallet = wallet.activeWallet.value
  if (!from || !activeWallet || rewards.rewardsFor.value !== from) return
  if (!unlocked()) return
  if (submitting.value) return
  actionError.value = null
  submitting.value = true
  try {
    await runPending(`collect:${from}:pillar`, () =>
      rewards.collectReward(
        activeWallet,
        from,
        'pillar',
        collectMeta('pillar', 'Collecting pillar & delegation rewards')
      )
    )
  } catch (err) {
    setError(
      `Couldn't collect pillar & delegation rewards: ${errorText(err, 'Failed to collect reward')}`
    )
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Pillars</h1>
      <p class="text-sm text-muted-foreground">
        Delegate your ZNN weight to a pillar to earn delegation rewards. Your ZNN never leaves your
        account.
      </p>
    </div>

    <div v-if="!address" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <section
        aria-label="Current delegation"
        class="flex flex-wrap items-center gap-6 rounded-xl border bg-card px-6 py-5 shadow-md"
      >
        <span class="flex size-12 items-center justify-center rounded-lg bg-accent text-primary">
          <LandmarkIcon class="size-6" aria-hidden="true" />
        </span>
        <div v-if="!delegationLoaded" class="flex flex-1 justify-center"><Spinner /></div>
        <template v-else>
          <div class="flex flex-[1_1_200px] flex-col gap-1">
            <template v-if="delegation">
              <span class="text-ledger text-muted-foreground">Delegating to</span>
              <span class="text-xl font-semibold">{{ delegation.name }}</span>
            </template>
            <template v-else>
              <span class="text-xl font-semibold">Not delegating</span>
              <span class="text-sm text-muted-foreground">
                Pick a pillar below to delegate your ZNN weight.
              </span>
            </template>
          </div>
          <template v-if="delegation">
            <div class="flex flex-[1_1_140px] flex-col gap-1">
              <span class="text-ledger text-muted-foreground">Your weight</span>
              <Amount
                :value="formatAmount(BigInt(delegation.weight), 8)"
                :decimals="2"
                symbol="ZNN"
                class="text-base font-semibold"
              />
            </div>
            <div class="flex flex-[1_1_140px] flex-col gap-1">
              <span class="text-ledger text-muted-foreground">Est. APR</span>
              <span class="font-mono text-base font-semibold tabular-nums">{{ delegatedApr }}</span>
            </div>
          </template>
          <div class="flex flex-[1_1_140px] flex-col gap-1">
            <span class="text-ledger text-muted-foreground">Uncollected</span>
            <Amount
              v-if="rewardsLoaded"
              :value="formatAmount(pillarReward.znn, 8)"
              :decimals="2"
              symbol="ZNN"
              class="text-base font-semibold"
            />
            <Spinner v-else />
          </div>
          <div class="flex gap-2">
            <Button
              v-if="delegation"
              variant="outline"
              :disabled="submitting || isPending(pendingKey)"
              @click="undelegate"
            >
              Undelegate
            </Button>
            <Button :disabled="!rewardsLoaded || !canCollect || submitting" @click="collect">
              Collect rewards
            </Button>
          </div>
        </template>
      </section>

      <Alert
        v-if="actionError"
        variant="destructive"
        class="flex flex-wrap items-center gap-3 text-sm"
      >
        <span>{{ actionError.message }}</span>
        <RouterLink
          v-if="actionError.timeout"
          :to="{ name: 'activity' }"
          class="font-semibold underline"
          >Check activity</RouterLink
        >
      </Alert>

      <section aria-labelledby="web-pillars-all" class="rounded-xl border bg-card">
        <div class="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <h2 id="web-pillars-all" class="grow text-base font-semibold">All pillars</h2>
          <label for="web-pillar-search" class="sr-only">Search pillars by name or owner</label>
          <Input
            id="web-pillar-search"
            v-model="query"
            placeholder="Search pillars by name or owner"
            autocomplete="off"
            class="w-60"
          />
          <Tabs :model-value="sort" @update:model-value="setSort">
            <TabsList>
              <TabsTrigger value="apr">APR</TabsTrigger>
              <TabsTrigger value="rank">Rank</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div
          v-if="pillar.isLoading.value && pillar.pillars.value.length === 0"
          class="flex justify-center py-6"
        >
          <Spinner />
        </div>
        <Alert
          v-else-if="pillar.error.value && pillar.pillars.value.length === 0"
          variant="destructive"
          class="m-5 text-sm"
        >
          {{ pillar.error.value }}
        </Alert>
        <p v-else-if="visible.length === 0" class="px-5 py-4 text-sm text-muted-foreground">
          No pillar matches “{{ query }}”.
        </p>
        <div v-else class="relative overflow-x-auto">
          <table class="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr class="text-ledger text-muted-foreground">
                <th class="w-12 py-2.5 pr-3 pl-5 text-right font-medium">#</th>
                <th class="px-3 py-2.5 text-left font-medium">Pillar</th>
                <th class="px-3 py-2.5 text-right font-medium">Est. APR</th>
                <th class="px-3 py-2.5 text-right font-medium">Weight</th>
                <th class="px-3 py-2.5 text-right font-medium">Momentums</th>
                <th class="px-5 py-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in visible" :key="p.name" class="border-t">
                <td class="py-3 pr-3 pl-5 text-right font-mono text-muted-foreground tabular-nums">
                  {{ p.rank + 1 }}
                </td>
                <td class="px-3 py-3">
                  <span class="flex flex-col gap-0.5">
                    <span class="font-semibold">{{ p.name }}</span>
                    <Address
                      :address="p.ownerAddress.toString()"
                      :start="6"
                      :end="4"
                      :href="explorerAccountUrl(p.ownerAddress.toString())"
                      class="text-xs"
                    />
                  </span>
                </td>
                <td class="px-3 py-3 text-right font-mono tabular-nums">
                  {{ p.delegateApr.toFixed(2) }}%
                </td>
                <td class="px-3 py-3 text-right">
                  <Amount
                    :value="formatAmount(BigInt(p.weight.toString()), 8)"
                    compact
                    symbol="ZNN"
                  />
                </td>
                <td class="px-3 py-3 text-right font-mono tabular-nums">
                  {{ p.currentStats.producedMomentums }} / {{ p.currentStats.expectedMomentums }}
                </td>
                <td class="px-5 py-3 text-right">
                  <Badge v-if="delegation?.name === p.name" variant="success">Delegated</Badge>
                  <Button
                    v-else
                    variant="outline"
                    size="sm"
                    :aria-label="`Delegate to ${p.name}`"
                    :disabled="submitting || isPending(pendingKey) || !delegationLoaded"
                    @click="delegate(p)"
                  >
                    Delegate
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

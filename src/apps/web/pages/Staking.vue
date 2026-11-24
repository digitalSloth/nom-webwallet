<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ZNN_ZTS } from 'znn-typescript-sdk'
import type { StakeEntry } from 'znn-typescript-sdk'
import { onTxProgress, useAccount, useStake, useWallet } from '@/core'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { MIN_STAKE_AMOUNT_ZNN, STAKE_DURATION_OPTIONS, STAKE_MONTH_SECONDS } from '@/config'
import { Alert, Amount, Badge, Button, Input, Spinner } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { isPending, runPending } from '@/shared/lib/pending-calls'
import { parseStakeAmount } from '../lib/stake-amount'

const wallet = useWallet()
const stake = useStake()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)

const address = active()
const submitting = ref(false)
const amount = ref('')
const duration = ref(STAKE_DURATION_OPTIONS[0].value)
const actionError = ref<{ message: string; timeout: boolean } | null>(null)

const stakeKey = `stake:${address}`
const cancelKey = (id: StakeEntry['id']) => `stake-cancel:${address}:${id.toString()}`

function reload(): void {
  if (address) void stake.loadStakeEntries(address)
}

const stop = onTxProgress((tx) => {
  if (tx.address === address) reload()
})
onBeforeUnmount(stop)
onBeforeRouteLeave(() => !submitting.value)
onMounted(reload)

const loaded = computed(() => stake.stakeEntriesFor.value === address)
const entries = computed(() => (loaded.value ? stake.stakeEntries.value : []))
const stakedTotal = computed(() => entries.value.reduce((sum, e) => sum + BigInt(e.amount), 0n))

const available = computed(() => {
  const row = account.balances.value.find((b) => b.tokenStandard === ZNN_ZTS.toString())
  return row ? BigInt(row.balance) : 0n
})

const parsed = computed(() => parseStakeAmount(amount.value, available.value))

const now = () => Math.floor(Date.now() / 1000)
const months = (seconds: number) => seconds / STAKE_MONTH_SECONDS
const monthsLabel = (m: number) => `${m} ${m === 1 ? 'month' : 'months'}`
const formatDay = (s: number) =>
  new Date(s * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const durationLabel = computed(() => monthsLabel(months(duration.value)))
const unlocksAt = computed(() => formatDay(now() + duration.value))

function daysLeft(expiration: number): string {
  const d = Math.ceil((expiration - now()) / 86400)
  return d === 1 ? '1 day left' : `${d} days left`
}

// Locked wallets show the locked overlay; the check re-reads the session first.
function unlocked(): boolean {
  wallet.refreshLockState()
  return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
}

function setError(message: string): void {
  actionError.value = { message, timeout: message === SEND_TIMEOUT_MESSAGE }
}

async function submitStake(): Promise<void> {
  const raw = parsed.value.raw
  const seconds = duration.value
  const from = active()
  const activeWallet = wallet.activeWallet.value
  if (raw === null || !from || !activeWallet) return
  if (!unlocked()) return
  if (submitting.value) return
  const amt = formatAmount(raw, 8)
  actionError.value = null
  submitting.value = true
  try {
    const block = await runPending(`stake:${from}`, () =>
      stake.stakeZnn(activeWallet, from, seconds, raw, {
        kind: 'contract',
        title: `Staking · Stake ${amt} ZNN`,
        progress: `Staking ${amt} ZNN`,
        amount: raw.toString(),
        decimals: 8,
        symbol: 'ZNN',
        tokenStandard: ZNN_ZTS.toString(),
      })
    )
    if (block) amount.value = ''
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to stake ZNN')
  } finally {
    submitting.value = false
  }
}

async function cancel(entry: StakeEntry): Promise<void> {
  const from = active()
  const activeWallet = wallet.activeWallet.value
  if (!from || !activeWallet || stake.stakeEntriesFor.value !== from) return
  if (!unlocked()) return
  if (submitting.value) return
  actionError.value = null
  submitting.value = true
  try {
    await runPending(`stake-cancel:${from}:${entry.id.toString()}`, () =>
      stake.cancelStake(activeWallet, from, entry.id.toString(), {
        kind: 'contract',
        title: 'Staking · Cancel stake',
        progress: 'Cancelling stake',
        amount: entry.amount.toString(),
        decimals: 8,
        symbol: 'ZNN',
        tokenStandard: ZNN_ZTS.toString(),
      })
    )
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to cancel stake')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Staking</h1>
      <p class="text-sm text-muted-foreground">
        Lock ZNN for a fixed period to earn QSR. Longer stakes earn more. Locked ZNN can't be moved
        until the stake ends.
      </p>
    </div>

    <div v-if="!address" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-start gap-5">
        <form
          aria-labelledby="web-stake-new"
          class="flex min-w-0 flex-[3_1_440px] flex-col gap-5 rounded-xl border bg-card p-6 shadow-md"
          @submit.prevent
        >
          <h2 id="web-stake-new" class="text-base font-semibold">New stake</h2>
          <fieldset :disabled="submitting" class="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
            <div class="flex flex-col gap-2">
              <span class="flex items-baseline justify-between">
                <label for="web-stake-amount" class="text-ledger text-muted-foreground">
                  Amount (ZNN)
                </label>
                <span class="text-xs text-muted-foreground">
                  Available
                  <span class="font-mono tabular-nums">{{ formatAmount(available, 8) }}</span> · Min
                  <span class="font-mono">{{ MIN_STAKE_AMOUNT_ZNN }}</span>
                </span>
              </span>
              <Input
                id="web-stake-amount"
                v-model="amount"
                numeric
                placeholder="10"
                autocomplete="off"
                class="h-[52px] text-[22px]"
              />
              <p v-if="parsed.error" class="text-xs text-destructive">{{ parsed.error }}</p>
            </div>
            <div class="flex flex-col gap-2">
              <span class="text-ledger text-muted-foreground">Duration</span>
              <div
                role="radiogroup"
                aria-label="Duration"
                class="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2 desktop:grid-cols-5"
              >
                <button
                  v-for="option in STAKE_DURATION_OPTIONS"
                  :key="option.value"
                  type="button"
                  role="radio"
                  :aria-checked="duration === option.value"
                  :class="[
                    'h-11 rounded-md border text-sm',
                    duration === option.value
                      ? 'border-primary bg-accent font-semibold'
                      : 'border-border bg-transparent',
                  ]"
                  @click="duration = option.value"
                >
                  {{ monthsLabel(months(option.value)) }}
                </button>
              </div>
            </div>
          </fieldset>
        </form>

        <aside
          aria-labelledby="web-stake-summary"
          class="flex min-w-0 flex-[2_1_300px] flex-col gap-3.5 rounded-xl border bg-card p-6"
        >
          <h2 id="web-stake-summary" class="text-base font-semibold">Summary</h2>
          <dl class="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
            <dt class="self-center text-ledger text-muted-foreground">Stake</dt>
            <dd class="m-0">
              <Amount
                v-if="parsed.raw !== null"
                :value="formatAmount(parsed.raw, 8)"
                :decimals="2"
                symbol="ZNN"
                class="font-semibold"
              />
              <span v-else>—</span>
            </dd>
            <dt class="self-center text-ledger text-muted-foreground">Duration</dt>
            <dd class="m-0">{{ durationLabel }}</dd>
            <dt class="self-center text-ledger text-muted-foreground">Unlocks</dt>
            <dd class="m-0">{{ unlocksAt }}</dd>
            <dt class="self-center text-ledger text-muted-foreground">Rewards</dt>
            <dd class="m-0">
              QSR, collected in
              <RouterLink :to="{ name: 'rewards' }" class="text-info no-underline"
                >Rewards</RouterLink
              >
            </dd>
          </dl>
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
          <Button
            class="w-full"
            size="lg"
            :disabled="parsed.raw === null || submitting || isPending(stakeKey)"
            @click="submitStake"
          >
            <template v-if="submitting"><Spinner /> Staking…</template>
            <template v-else-if="parsed.raw !== null">
              Stake {{ formatAmount(parsed.raw, 8) }} ZNN
            </template>
            <template v-else>Stake ZNN</template>
          </Button>
        </aside>
      </div>

      <section aria-labelledby="web-stake-active" class="rounded-xl border bg-card">
        <div class="flex items-center gap-3 border-b px-5 py-4">
          <h2 id="web-stake-active" class="grow text-base font-semibold">Active stakes</h2>
          <span v-if="loaded" class="text-[13px] text-muted-foreground">
            <span class="font-mono">{{ formatAmount(stakedTotal, 8) }}</span> ZNN staked
          </span>
        </div>
        <div v-if="!loaded" class="flex justify-center py-4"><Spinner /></div>
        <p v-else-if="entries.length === 0" class="px-5 py-4 text-sm text-muted-foreground">
          No active stakes
        </p>
        <div v-else class="relative overflow-x-auto">
          <table class="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr class="text-ledger text-muted-foreground">
                <th class="px-5 py-2.5 text-right font-medium">Amount</th>
                <th class="px-3 py-2.5 text-left font-medium">Duration</th>
                <th class="px-3 py-2.5 text-left font-medium">Started</th>
                <th class="px-3 py-2.5 text-left font-medium">Unlocks</th>
                <th class="px-5 py-2.5"><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in entries" :key="entry.id.toString()" class="border-t">
                <td class="px-5 py-3.5 text-right">
                  <Amount
                    :value="formatAmount(BigInt(entry.amount), 8)"
                    :decimals="8"
                    symbol="ZNN"
                    class="font-semibold"
                  />
                </td>
                <td class="px-3 py-3.5">
                  {{
                    monthsLabel(
                      Math.round(
                        (entry.expirationTimestamp - entry.startTimestamp) / STAKE_MONTH_SECONDS
                      )
                    )
                  }}
                </td>
                <td class="px-3 py-3.5 text-muted-foreground">
                  {{ formatDay(entry.startTimestamp) }}
                </td>
                <td class="px-3 py-3.5">
                  {{ formatDay(entry.expirationTimestamp) }} ·
                  <span v-if="entry.expirationTimestamp > now()" class="text-muted-foreground">{{
                    daysLeft(entry.expirationTimestamp)
                  }}</span>
                  <span v-else class="text-success">Ended</span>
                </td>
                <td class="px-5 py-3.5 text-right">
                  <Badge v-if="entry.expirationTimestamp > now()" variant="secondary">Locked</Badge>
                  <Button
                    v-else
                    variant="outline"
                    size="sm"
                    :disabled="submitting || isPending(cancelKey(entry.id))"
                    @click="cancel(entry)"
                  >
                    Cancel and return ZNN
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

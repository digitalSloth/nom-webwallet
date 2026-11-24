<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Amount, Button, Skeleton, Spinner, TxDirection, TxStatus } from 'nom-ui'
import { addNumberDecimals } from 'znn-typescript-sdk'
import { useAccountHistory, useTrackedTransactions } from '@/core'
import {
  blockStatusLabel,
  blockStatusTone,
  explorerAccountUrl,
  relativeTime,
  shortAddress,
} from '@/shared/lib/format'
import { txKind, txProgress } from '@/shared/lib/tx-progress'

const props = defineProps<{ address: string | null }>()

const { rows, isLoading, error, loadFirst } = useAccountHistory(() => props.address)

watch(
  () => props.address,
  () => void loadFirst(),
  { immediate: true }
)

const router = useRouter()
const { entries } = useTrackedTransactions()

const inFlight = computed(() =>
  props.address === null
    ? []
    : entries.value.filter((e) => !e.done && e.tx.address === props.address)
)

// A transaction that finished tracking now belongs in the history.
watch(
  () => inFlight.value.length,
  (count, previous) => {
    if (count < previous) void loadFirst()
  }
)

type Row = (typeof rows.value)[number]

const DIRECTIONS = {
  in: { direction: 'in', label: 'In' },
  out: { direction: 'out', label: 'Sent' },
  contract: { direction: 'out', label: 'Call' },
} as const

function partyLine(row: Row): string {
  const party =
    row.direction === 'contract'
      ? (row.label ?? shortAddress(row.counterparty))
      : row.counterparty
        ? shortAddress(row.counterparty)
        : 'Unknown'
  return row.timestamp === null ? party : `${party} · ${relativeTime(row.timestamp)}`
}
</script>

<template>
  <ul v-if="inFlight.length > 0" class="divide-y border-b">
    <li v-for="entry in inFlight" :key="entry.tx.hash">
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3 text-left"
        @click="router.push({ name: 'tx', params: { hash: entry.tx.hash } })"
      >
        <Spinner class="size-4 shrink-0" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">
            {{ entry.tx.meta?.title ?? entry.tx.label }}
          </div>
          <div class="truncate text-xs text-muted-foreground">
            {{ txProgress(entry.stage, txKind(entry.tx)).text }}
          </div>
        </div>
      </button>
    </li>
  </ul>
  <div v-if="isLoading && rows.length === 0" class="space-y-3 p-4">
    <Skeleton v-for="n in 4" :key="n" class="h-10 w-full" />
  </div>
  <div v-else-if="error && rows.length === 0" class="space-y-3 p-6 text-center">
    <p class="text-sm text-muted-foreground">{{ error }}</p>
    <Button variant="outline" size="sm" @click="loadFirst">Try again</Button>
  </div>
  <p
    v-else-if="rows.length === 0 && inFlight.length === 0"
    class="p-6 text-center text-sm text-muted-foreground"
  >
    No activity yet
  </p>
  <div v-else-if="rows.length > 0">
    <ul class="divide-y">
      <li v-for="row in rows" :key="row.hash" class="flex items-center gap-2.5 px-4 py-3">
        <TxDirection
          :direction="DIRECTIONS[row.direction].direction"
          :label="DIRECTIONS[row.direction].label"
        />
        <div class="min-w-0 flex-1">
          <div
            v-if="row.amount !== '0'"
            class="flex items-baseline gap-0.5 text-[13px] font-semibold"
          >
            <span v-if="row.direction === 'in'">+</span>
            <span v-else-if="row.direction === 'out'">-</span>
            <Amount
              :value="addNumberDecimals(row.amount, row.decimals)"
              :decimals="Math.min(row.decimals, 4)"
              :symbol="row.symbol"
            />
          </div>
          <div v-else class="truncate text-[13px] font-semibold">
            {{ row.label ?? 'Contract call' }}
          </div>
          <div class="truncate text-[11px] text-muted-foreground">{{ partyLine(row) }}</div>
        </div>
        <TxStatus :status="blockStatusTone(row.status)" :label="blockStatusLabel(row.status)" />
      </li>
    </ul>
    <p v-if="address" class="py-2 text-center text-xs">
      <a
        :href="explorerAccountUrl(address)"
        target="_blank"
        rel="noopener noreferrer"
        class="text-info"
        >Older activity</a
      >
    </p>
  </div>
</template>

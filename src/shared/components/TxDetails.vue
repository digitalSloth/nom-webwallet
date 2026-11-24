<script setup lang="ts">
import { computed } from 'vue'
import { useNetwork, useWallet } from '@/core'
import type { TrackedEntry } from '@/core'
import { Address } from 'nom-ui'
import TxTimeline from './TxTimeline.vue'
import { formatAmount } from '../lib/amount'
import { shortAddress } from '../lib/format'
import { rejectedBanner, txKind, txProgress } from '../lib/tx-progress'

const props = defineProps<{ entry: TrackedEntry }>()

const wallet = useWallet()
const network = useNetwork()

const kind = computed(() => txKind(props.entry.tx))
const progress = computed(() => txProgress(props.entry.stage, kind.value))
const meta = computed(() => props.entry.tx.meta)

const node = computed(() => {
  const url = network.currentNode.value
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
})

const amountText = computed(() => {
  const m = meta.value
  if (!m?.amount || m.decimals === undefined || !m.symbol) return null
  return formatAmount(BigInt(m.amount), m.decimals)
})

const subline = computed(() => {
  const current = props.entry
  if (current.tx.meta?.origin) return `Requested by ${current.tx.meta.origin}`
  const label = wallet.activeWallet.value?.accounts.find(
    (a) => a.address === current.tx.address
  )?.label
  return `From ${label ?? shortAddress(current.tx.address)}`
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col items-center gap-1 pt-2 pb-1 text-center">
      <span v-if="amountText !== null" class="font-mono text-[26px] font-semibold tabular-nums">
        {{ amountText }} {{ meta?.symbol }}
      </span>
      <span class="text-[13px] text-muted-foreground">{{ subline }}</span>
    </div>

    <TxTimeline :stage="entry.stage" :kind="kind" :node="node" />

    <div
      v-if="progress.banner === 'failed'"
      role="alert"
      class="rounded-lg border border-destructive px-3 py-2.5 text-xs leading-relaxed text-destructive"
    >
      Confirmed in momentum {{ progress.momentum?.toLocaleString('en-US') }}, but the contract call
      failed. Check the explorer for the reason.
    </div>
    <div
      v-else-if="entry.stage.kind === 'rejected'"
      role="alert"
      class="rounded-lg border border-destructive px-3 py-2.5 text-xs leading-relaxed text-destructive"
    >
      {{ rejectedBanner(entry.stage.reason) }}
    </div>
    <div
      v-else-if="progress.banner === 'stale'"
      role="status"
      class="rounded-lg border border-warning px-3 py-2.5 text-xs leading-relaxed"
    >
      Still waiting after several minutes. The transaction may still confirm. Check the explorer.
    </div>

    <dl class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm">
      <template v-if="entry.stage.kind !== 'rejected'">
        <dt class="text-ledger text-muted-foreground">Hash</dt>
        <dd><Address :address="entry.tx.hash" :start="8" :end="6" copy /></dd>
      </template>
      <template v-if="meta?.recipient">
        <dt class="text-ledger text-muted-foreground">To</dt>
        <dd><Address :address="meta.recipient" :start="8" :end="6" /></dd>
      </template>
    </dl>
  </div>
</template>

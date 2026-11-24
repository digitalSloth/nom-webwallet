<script setup lang="ts">
import { computed, ref } from 'vue'
import { REWARD_SOURCE_LABELS } from '@/core'
import type { RewardEpoch } from '@/core'
import { Tabs, TabsList, TabsTrigger } from 'nom-ui'
import { formatAmount } from '@/shared/lib/amount'
import {
  axisTicks,
  chartBars,
  chartSources,
  epochLabel,
  epochMax,
  nextFocus,
  SOURCE_COLORS,
  type ChartToken,
} from '@/shared/lib/rewards-chart'

const props = defineProps<{
  history: RewardEpoch[]
  genesisAt: number | null
}>()

const token = ref<ChartToken>('znn')
const active = ref<number | null>(null)
const barEls = ref<(Element | null)[]>([])

const symbol = computed(() => token.value.toUpperCase())
const n = computed(() => props.history.length)
const sources = computed(() => chartSources(props.history, token.value))

// Display only: bar heights are fractions of the axis, amounts print exactly.
const maxTotal = computed(() => epochMax(props.history, token.value))
const ticks = computed(() => axisTicks(maxTotal.value))
const bars = computed(() => chartBars(props.history, token.value, ticks.value[4]))
const rangeTotal = computed(() => bars.value.reduce((sum, bar) => sum + bar.total, 0n))
const isEmpty = computed(() => n.value === 0 || rangeTotal.value === 0n)

function totalOf(row: RewardEpoch): bigint {
  let total = 0n
  for (const raw of Object.values(row[token.value])) total += BigInt(raw)
  return total
}

const label = (epoch: number) => epochLabel(epoch, props.genesisAt)

const tooltipShift = computed(() => {
  const i = active.value
  if (i === null) return '0'
  if (i < 6) return '0'
  if (i > n.value - 8) return '-100%'
  return '-50%'
})

const tooltip = computed(() => {
  const i = active.value
  if (i === null || !props.history[i]) return null
  const row = props.history[i]
  return {
    left: `${((i + 0.5) / n.value) * 100}%`,
    label: label(row.epoch),
    rows: sources.value.map((type) => ({
      type,
      value: formatAmount(BigInt(row[token.value][type]), 8),
    })),
    total: formatAmount(bars.value[i].total, 8),
  }
})

const tableRows = computed(() =>
  [...props.history].reverse().map((row) => ({
    epoch: row.epoch,
    values: sources.value.map((type) => formatAmount(BigInt(row[token.value][type]), 8)),
    total: formatAmount(totalOf(row), 8),
  }))
)

const mid = computed(() => props.history[Math.floor(n.value / 2)]?.epoch)

function segmentY(bar: (typeof bars.value)[number], index: number): number {
  const below = bar.segments.slice(0, index + 1).reduce((sum, s) => sum + s.heightPct, 0)
  return 100 - below
}

function onKeydown(e: KeyboardEvent, i: number): void {
  const next = nextFocus(i, e.key, n.value)
  if (next === i) return
  e.preventDefault()
  ;(barEls.value[next] as HTMLElement | null)?.focus()
}

function setToken(value: string | number): void {
  token.value = value === 'qsr' ? 'qsr' : 'znn'
  active.value = null
}
</script>

<template>
  <section
    aria-labelledby="web-rewards-history"
    class="flex flex-col gap-4 rounded-xl border bg-card p-5"
  >
    <div class="flex flex-wrap items-start gap-4">
      <div class="flex grow flex-col gap-1">
        <h2 id="web-rewards-history" class="text-base font-semibold">Earned per epoch</h2>
        <span class="text-[13px] text-muted-foreground">
          Last {{ n }} epochs ·
          <span class="font-mono tabular-nums">{{ formatAmount(rangeTotal, 8) }}</span>
          {{ symbol }} earned
        </span>
      </div>
      <Tabs :model-value="token" @update:model-value="setToken">
        <TabsList>
          <TabsTrigger value="znn">ZNN</TabsTrigger>
          <TabsTrigger value="qsr">QSR</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>

    <p v-if="isEmpty" class="py-8 text-center text-sm text-muted-foreground">
      No {{ symbol }} rewards in the last 30 epochs.
    </p>

    <template v-else>
      <div class="flex flex-wrap gap-4 text-[13px] text-muted-foreground">
        <span v-for="type in sources" :key="type" class="flex items-center gap-1.5">
          <span class="size-2.5 rounded-sm" :style="{ background: SOURCE_COLORS[type] }" />
          {{ REWARD_SOURCE_LABELS[type] }}
        </span>
      </div>

      <div class="flex gap-2">
        <div aria-hidden="true" class="relative h-[220px] w-11 shrink-0">
          <span
            v-for="(tick, i) in ticks"
            :key="i"
            class="absolute right-0 translate-y-1/2 font-mono text-[11px] text-muted-foreground tabular-nums"
            :style="{ bottom: `${i * 25}%` }"
          >
            {{ tick.toLocaleString('en-US') }}
          </span>
        </div>
        <div class="relative min-w-0 grow">
          <div aria-hidden="true" class="absolute inset-x-0 top-0 h-[220px]">
            <span
              v-for="(_, i) in ticks"
              :key="i"
              class="absolute inset-x-0 h-px bg-border"
              :style="{ bottom: `${i * 25}%` }"
            />
          </div>
          <svg
            role="list"
            :aria-label="`${symbol} earned per epoch, last ${n} epochs`"
            class="relative h-[220px] w-full"
            :viewBox="`0 0 ${n * 10} 100`"
            preserveAspectRatio="none"
            @mouseleave="active = null"
          >
            <g
              v-for="(bar, i) in bars"
              :key="bar.epoch"
              :ref="(el) => (barEls[i] = el as Element | null)"
              role="listitem"
              tabindex="0"
              :aria-label="`${label(bar.epoch)}: ${formatAmount(bar.total, 8)} ${symbol}`"
              @mouseenter="active = i"
              @focus="active = i"
              @blur="active = null"
              @keydown="onKeydown($event, i)"
            >
              <rect
                :x="i * 10"
                y="0"
                width="10"
                height="100"
                :fill="active === i ? 'var(--muted)' : 'transparent'"
              />
              <rect
                v-for="(segment, s) in bar.segments"
                :key="segment.type"
                :x="i * 10 + 1"
                :y="segmentY(bar, s)"
                width="8"
                :height="segment.heightPct"
                :fill="SOURCE_COLORS[segment.type]"
              />
            </g>
          </svg>
          <div
            role="status"
            aria-live="polite"
            class="pointer-events-none absolute top-0"
            :style="tooltip ? { left: tooltip.left, transform: `translateX(${tooltipShift})` } : {}"
          >
            <div
              v-if="tooltip"
              class="flex min-w-[180px] flex-col gap-1 rounded-lg border bg-popover px-3 py-2.5 text-xs shadow-lg"
            >
              <span class="text-ledger text-muted-foreground">{{ tooltip.label }}</span>
              <span v-for="row in tooltip.rows" :key="row.type" class="flex items-center gap-1.5">
                <span class="size-2 rounded-sm" :style="{ background: SOURCE_COLORS[row.type] }" />
                <span class="grow">{{ REWARD_SOURCE_LABELS[row.type] }}</span>
                <span class="font-mono tabular-nums">{{ row.value }}</span>
              </span>
              <span class="flex gap-1.5 border-t pt-1 font-semibold">
                <span class="grow">Total</span>
                <span class="font-mono tabular-nums">{{ tooltip.total }} {{ symbol }}</span>
              </span>
            </div>
          </div>
          <div
            aria-hidden="true"
            class="mt-2 flex justify-between text-[11px] text-muted-foreground"
          >
            <span class="font-mono tabular-nums">{{ history[0].epoch }}</span>
            <span class="font-mono tabular-nums">{{ mid }}</span>
            <span class="font-mono tabular-nums">{{ history[n - 1].epoch }}</span>
          </div>
        </div>
      </div>

      <details class="text-[13px]">
        <summary class="cursor-pointer text-muted-foreground">View as table</summary>
        <div class="mt-2 max-h-60 overflow-auto rounded-lg border">
          <table class="w-full border-collapse text-[13px]">
            <thead>
              <tr class="text-ledger text-muted-foreground">
                <th class="px-3 py-2 text-left font-medium">Epoch</th>
                <th v-for="type in sources" :key="type" class="px-3 py-2 text-right font-medium">
                  {{ REWARD_SOURCE_LABELS[type] }}
                </th>
                <th class="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in tableRows" :key="row.epoch" class="border-t">
                <td class="px-3 py-1.5 font-mono tabular-nums">{{ row.epoch }}</td>
                <td
                  v-for="(value, i) in row.values"
                  :key="i"
                  class="px-3 py-1.5 text-right font-mono tabular-nums"
                >
                  {{ value }}
                </td>
                <td class="px-3 py-1.5 text-right font-mono tabular-nums">{{ row.total }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </template>

    <span class="text-xs text-muted-foreground">
      From each embedded contract's reward history on the node.
    </span>
  </section>
</template>

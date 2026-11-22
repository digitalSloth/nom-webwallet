<script setup lang="ts">
import { computed, ref } from 'vue'
import { REWARD_SOURCE_LABELS } from '@/core'
import type { RewardEpoch } from '@/core'
import { Tabs, TabsList, TabsTrigger } from 'nom-ui'
import { formatAmount } from '@/shared/lib/amount'
import {
  SOURCE_COLORS,
  chartBars,
  chartSources,
  epochMax,
  type ChartToken,
} from '@/shared/lib/rewards-chart'

const props = defineProps<{ history: RewardEpoch[] }>()

const token = ref<ChartToken>('znn')

const symbol = computed(() => token.value.toUpperCase())
const bars = computed(() =>
  chartBars(props.history, token.value, epochMax(props.history, token.value))
)
const rangeTotal = computed(() => bars.value.reduce((sum, bar) => sum + bar.total, 0n))
const sources = computed(() => chartSources(props.history, token.value))
const isEmpty = computed(() => props.history.length === 0 || rangeTotal.value === 0n)
const label = computed(
  () =>
    `${symbol.value} earned per epoch over the last ${props.history.length} epochs, ${formatAmount(rangeTotal.value, 8)} in total`
)
const firstEpoch = computed(() => props.history[0]?.epoch ?? 0)
const lastEpoch = computed(() => props.history[props.history.length - 1]?.epoch ?? 0)

function setToken(value: string | number): void {
  token.value = value === 'qsr' ? 'qsr' : 'znn'
}
</script>

<template>
  <section aria-labelledby="small-rewards-history" class="flex flex-col gap-2">
    <div class="flex items-center gap-2">
      <h2 id="small-rewards-history" class="flex-1 text-ledger font-medium text-muted-foreground">
        Earned per epoch
      </h2>
      <Tabs :model-value="token" @update:model-value="setToken">
        <TabsList>
          <TabsTrigger value="znn">ZNN</TabsTrigger>
          <TabsTrigger value="qsr">QSR</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
    <div class="text-xs text-muted-foreground">
      Last {{ history.length }} epochs ·
      <span class="font-mono tabular-nums">{{ formatAmount(rangeTotal, 8) }}</span>
      {{ symbol }}
    </div>

    <p v-if="isEmpty" class="py-6 text-center text-sm text-muted-foreground">
      No {{ symbol }} rewards in the last 30 epochs.
    </p>

    <template v-else>
      <div role="img" :aria-label="label" class="flex h-[88px] items-end gap-0.5 border-b">
        <span
          v-for="bar in bars"
          :key="bar.epoch"
          class="flex h-full min-w-0 flex-1 flex-col justify-end"
        >
          <span
            v-for="(segment, i) in [...bar.segments].reverse()"
            :key="segment.type"
            class="block"
            :class="{ 'rounded-t-[2px]': i === 0 }"
            :style="{ height: `${segment.heightPct}%`, background: SOURCE_COLORS[segment.type] }"
          />
        </span>
      </div>
      <div class="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span v-for="type in sources" :key="type" class="flex items-center gap-1.5">
          <span class="size-2 rounded-[2px]" :style="{ background: SOURCE_COLORS[type] }" />
          {{ REWARD_SOURCE_LABELS[type] }}
        </span>
        <span class="ml-auto font-mono tabular-nums">
          {{ firstEpoch.toLocaleString('en-US') }}–{{ lastEpoch.toLocaleString('en-US') }}
        </span>
      </div>
    </template>
  </section>
</template>

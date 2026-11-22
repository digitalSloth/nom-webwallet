<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { CheckIcon, ZapIcon } from 'lucide-vue-next'
import { isGeneratingPow, sendContext, sendPhase } from '@/core'
import { formatAmount } from '@/shared/lib/amount'
import { shortAddress } from '@/shared/lib/format'
import { SHEET_BACKDROP, SHEET_CARD } from '../lib/sheet'

const shown = ref(false)
const startedAt = ref(0)
const now = ref(0)
let timer: ReturnType<typeof setInterval> | undefined

function stopTimer(): void {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

watch(isGeneratingPow, (generating) => {
  if (!generating || sendPhase.value === null || shown.value) return
  if (sendContext.value?.background) return
  shown.value = true
  startedAt.value = Date.now()
  now.value = startedAt.value
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

watch(sendPhase, (phase) => {
  if (phase !== null) return
  shown.value = false
  stopTimer()
})

onBeforeUnmount(stopTimer)

const publishing = computed(() => sendPhase.value === 'publishing')
const elapsed = computed(() => {
  const seconds = Math.max(0, Math.floor((now.value - startedAt.value) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} elapsed`
})

const steps = computed(() => {
  const generating = isGeneratingPow.value
  return [
    { label: 'Checked plasma', state: 'done' },
    { label: 'Generating PoW', state: generating ? 'active' : 'done' },
    { label: 'Signing and publishing', state: publishing.value ? 'active' : 'todo' },
  ]
})

const action = computed(() => sendContext.value?.progress ?? sendContext.value?.title ?? null)

const summary = computed(() => {
  const context = sendContext.value
  if (!context?.amount || context.decimals === undefined || !context.symbol) return ''
  const amount = `${formatAmount(BigInt(context.amount), context.decimals)} ${context.symbol}`
  return context.recipient ? `${amount} to ${shortAddress(context.recipient)}.` : `${amount}.`
})
</script>

<template>
  <div
    v-if="shown"
    class="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
    :class="SHEET_BACKDROP"
  >
    <div
      class="flex w-full max-w-[440px] flex-col gap-[22px] rounded-xl border bg-card p-8 text-foreground shadow-xl"
      :class="SHEET_CARD"
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby="pow-heading"
    >
      <div class="flex flex-col items-center gap-2.5 text-center">
        <span class="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
          <ZapIcon class="size-6" aria-hidden="true" />
        </span>
        <h2 id="pow-heading" class="text-[22px] font-semibold">
          {{ publishing ? 'Publishing transaction' : 'Generating PoW' }}
        </h2>
        <p v-if="action" class="text-[15px] font-medium">{{ action }}</p>
        <p class="font-mono text-[13px] text-muted-foreground tabular-nums">{{ elapsed }}</p>
      </div>

      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <div class="pow-indeterminate h-full w-2/5 rounded-full bg-plasma" />
      </div>

      <ol class="space-y-2.5" aria-label="Steps">
        <li v-for="(step, i) in steps" :key="step.label" class="flex items-center gap-2.5 text-sm">
          <span
            :class="[
              'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
              step.state === 'done' && 'bg-success text-success-foreground',
              step.state === 'active' && 'bg-primary text-primary-foreground',
              step.state === 'todo' && 'border text-muted-foreground',
            ]"
          >
            <CheckIcon v-if="step.state === 'done'" class="size-3" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span :class="step.state === 'todo' && 'text-muted-foreground'">{{ step.label }}</span>
        </li>
      </ol>

      <div class="space-y-1.5 rounded-lg bg-muted p-3 text-[13px] leading-normal">
        <p class="font-semibold">
          Keep this tab open until the transaction is sent. Closing it cancels the send.
        </p>
        <p v-if="sendContext" class="text-muted-foreground">
          <template v-if="summary">{{ summary }} </template>Low plasma, so this device generates PoW
          for each transaction. Usually under a minute each.
        </p>
        <p v-else class="text-muted-foreground">
          Low plasma, so this device is generating PoW. It usually takes under a minute.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes pow-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
.pow-indeterminate {
  animation: pow-slide 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
</style>

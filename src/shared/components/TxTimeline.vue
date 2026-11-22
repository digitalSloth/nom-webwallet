<script setup lang="ts">
import { computed } from 'vue'
import { CheckIcon } from 'lucide-vue-next'
import type { TxStage } from '@/core'
import { txProgress } from '../lib/tx-progress'
import type { TxKind } from '../lib/tx-progress'

const props = defineProps<{ stage: TxStage; kind: TxKind; node: string | null }>()

const progress = computed(() => txProgress(props.stage, props.kind))

const steps = computed(() => {
  const stage = props.stage
  if (stage.kind === 'rejected') {
    return [
      {
        label: 'Not published',
        detail: `Rejected by ${stage.node}`,
        i: 1,
        done: false,
        active: false,
        bad: true,
        lineDone: false,
      },
    ]
  }
  const { reached, momentum, banner } = progress.value
  const failed = banner === 'failed'
  const contract = props.kind === 'contract'
  const lastLabel = contract
    ? failed
      ? 'Contract call failed'
      : 'Contract executed'
    : props.kind === 'receive'
      ? 'Received'
      : 'Received by recipient'
  const labels = ['Published', 'Confirmed', lastLabel]

  return labels.map((label, index) => {
    const i = index + 1
    const done = i <= reached
    const active = i === reached + 1 && banner === null
    const bad = failed && i === 3
    let detail = ''
    if (i === 1 && done && props.node) detail = `Sent to ${props.node}`
    if (i === 2) {
      if (done && momentum !== null) detail = `In momentum ${momentum.toLocaleString('en-US')}`
      else if (active) detail = 'Waiting for the next momentum'
    }
    if (i === 3) {
      if (bad) detail = 'The contract rejected the call'
      else if (active)
        detail = contract
          ? 'Waiting for the contract'
          : 'Waiting for the recipient, this can take a while'
      else if (done)
        detail = contract
          ? 'The contract processed the call'
          : "The recipient's wallet created a receive block"
    }
    return { label, detail, i, done, active, bad, lineDone: done && i < reached }
  })
})
</script>

<template>
  <ol aria-label="Transaction progress" class="flex flex-col">
    <li v-for="(step, index) in steps" :key="step.i" class="flex gap-3">
      <span class="flex w-5 flex-col items-center">
        <span
          :class="[
            'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
            step.bad && 'bg-destructive text-destructive-foreground',
            !step.bad && step.done && 'bg-success text-success-foreground',
            !step.bad && !step.done && step.active && 'bg-primary text-primary-foreground',
            !step.bad && !step.done && !step.active && 'border text-muted-foreground',
          ]"
        >
          <template v-if="step.bad">!</template>
          <CheckIcon v-else-if="step.done" class="size-3" />
          <template v-else>{{ step.i }}</template>
        </span>
        <span
          v-if="index < steps.length - 1"
          :class="['min-h-[18px] w-0.5 flex-1', step.lineDone ? 'bg-success' : 'bg-border']"
        />
      </span>
      <span class="flex flex-col gap-0.5 pb-3.5">
        <span
          :class="[
            'text-sm',
            step.active ? 'font-semibold' : 'font-medium',
            step.bad && 'text-destructive',
            !step.bad && !step.done && !step.active && 'text-muted-foreground',
          ]"
          >{{ step.label }}</span
        >
        <span v-if="step.detail" class="text-xs text-muted-foreground">{{ step.detail }}</span>
      </span>
    </li>
  </ol>
</template>

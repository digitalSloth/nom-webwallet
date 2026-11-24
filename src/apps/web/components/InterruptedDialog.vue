<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useInterruptedSends, useWallet } from '@/core'
import { classify } from '@/core/send-record'
import { Button } from 'nom-ui'
import { AlertTriangleIcon, XCircleIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { explorerAccountUrl, relativeTime, shortAddress } from '@/shared/lib/format'
import { sendDraft } from '@/shared/lib/send-draft'
import { SHEET_BACKDROP, SHEET_CARD, SHEET_FOOTER } from '../lib/sheet'

const router = useRouter()
const wallet = useWallet()
const { current: record, dismiss, claim, retryTarget } = useInterruptedSends()

const acting = ref(false)

// With nothing left to show, the route returns to Home.
watchEffect(() => {
  if (!record.value && !acting.value) void router.replace({ name: 'home' })
})

const notSent = computed(() => record.value !== null && classify(record.value).kind === 'notSent')
const target = computed(() =>
  record.value ? retryTarget(record.value, wallet.activeAccountAddress.value) : null
)
const context = computed(() => record.value?.context ?? null)

const amountText = computed(() => {
  const c = context.value
  if (!c?.amount || c.decimals === undefined || !c.symbol) return null
  return formatAmount(BigInt(c.amount), c.decimals)
})

const otherAccount = computed(() => {
  const c = context.value
  return (
    c !== null && c.from !== wallet.activeAccountAddress.value && !c.origin && c.kind !== 'contract'
  )
})

async function dismissOnly(): Promise<void> {
  const current = record.value
  if (!current || acting.value) return
  acting.value = true
  try {
    await dismiss(current.id)
  } finally {
    acting.value = false
  }
}

async function checkActivity(): Promise<void> {
  const c = context.value
  const current = record.value
  if (!c || !current) return
  if (c.from !== wallet.activeAccountAddress.value) {
    window.open(explorerAccountUrl(c.from), '_blank', 'noopener,noreferrer')
    await dismissOnly()
    return
  }
  if (acting.value) return
  acting.value = true
  try {
    await dismiss(current.id)
    await router.replace({ name: 'activity' })
  } finally {
    acting.value = false
  }
}

async function tryAgain(): Promise<void> {
  const current = record.value
  const c = context.value
  const retry = target.value
  if (!current || !c || acting.value) return
  acting.value = true
  try {
    // Another tab may have retried this record already; only one claim wins.
    if (!(await claim(current))) return
    if (retry === 'send-review') {
      sendDraft.value = {
        tokenStandard: c.tokenStandard as string,
        symbol: c.symbol as string,
        decimals: c.decimals as number,
        amount: formatAmount(BigInt(c.amount as string), c.decimals as number),
        recipient: c.recipient as string,
        from: c.from,
      }
      await router.replace({ name: 'send' })
    } else if (retry === 'receive') {
      await router.replace({ name: 'receive' })
    }
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div
    v-if="record && context"
    class="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-6 py-[120px]"
    :class="SHEET_BACKDROP"
  >
    <div
      class="flex w-full max-w-[460px] flex-col gap-[18px] rounded-xl border bg-card p-7 text-foreground shadow-xl"
      :class="SHEET_CARD"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="interrupted-title"
      aria-describedby="interrupted-body"
    >
      <div class="flex gap-3.5">
        <span
          :class="[
            'flex size-11 shrink-0 items-center justify-center rounded-full',
            notSent ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning',
          ]"
        >
          <XCircleIcon v-if="notSent" class="size-[22px]" aria-hidden="true" />
          <AlertTriangleIcon v-else class="size-[22px]" aria-hidden="true" />
        </span>
        <div class="space-y-1.5">
          <h1 id="interrupted-title" class="text-lg font-semibold">
            {{
              notSent
                ? 'Previous transaction wasn’t sent'
                : 'Previous transaction may have been sent'
            }}
          </h1>
          <p id="interrupted-body" class="text-sm leading-relaxed text-muted-foreground">
            <template v-if="notSent">
              The tab closed while generating PoW, so nothing was published. No funds left your
              account.
            </template>
            <template v-else-if="record.detached">
              The node didn’t confirm this transaction in time, and it may still go through. Check
              Activity before you try again, so you don’t send it twice.
            </template>
            <template v-else>
              The tab closed while the transaction was being published. Check Activity before you
              try again, so you don’t send it twice.
            </template>
          </p>
        </div>
      </div>

      <dl
        class="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-lg bg-muted p-3.5 text-sm"
      >
        <template v-if="amountText !== null">
          <dt class="text-ledger text-muted-foreground">Amount</dt>
          <dd class="font-mono font-semibold tabular-nums">
            {{ amountText }} {{ context.symbol }}
          </dd>
        </template>
        <template v-if="context.recipient">
          <dt class="text-ledger text-muted-foreground">To</dt>
          <dd class="font-mono text-[13px]">{{ shortAddress(context.recipient) }}</dd>
        </template>
        <dt class="text-ledger text-muted-foreground">Started</dt>
        <dd>
          {{ relativeTime(record.startedAt) }} ·
          {{ record.stage === 'pow-started' ? 'stopped during PoW' : 'stopped during publishing' }}
        </dd>
        <template v-if="context.origin">
          <dt class="text-ledger text-muted-foreground">Requested</dt>
          <dd>Requested by {{ context.origin }}</dd>
        </template>
      </dl>

      <p v-if="otherAccount" class="text-xs text-muted-foreground">
        Sent from {{ shortAddress(context.from) }}. Switch to that account to try again.
      </p>

      <div class="flex justify-end gap-2" :class="SHEET_FOOTER">
        <Button variant="outline" :disabled="acting" @click="dismissOnly">Dismiss</Button>
        <template v-if="notSent">
          <Button v-if="target" :disabled="acting" @click="tryAgain">Try again</Button>
        </template>
        <Button v-else :disabled="acting" @click="checkActivity">Check activity</Button>
      </div>
    </div>
  </div>
</template>

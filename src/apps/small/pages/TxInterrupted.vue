<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useInterruptedSends, useWallet } from '@/core'
import { classify } from '@/core/send-record'
import { Button } from 'nom-ui'
import { AlertTriangleIcon, XCircleIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { relativeTime, shortAddress } from '@/shared/lib/format'
import { sendDraft } from '@/shared/lib/send-draft'
import { injectSmallHost } from '@/apps/small/host'

const router = useRouter()
const wallet = useWallet()
const { current: record, dismiss, claim, retryTarget } = useInterruptedSends()

const acting = ref(false)

watchEffect(() => {
  if (!record.value && !acting.value) void router.replace('/')
})

const notSent = computed(() => record.value !== null && classify(record.value).kind === 'notSent')
const place = injectSmallHost().placeLabel
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

async function leave(to: Parameters<typeof router.replace>[0]): Promise<void> {
  const current = record.value
  if (!current || acting.value) return
  acting.value = true
  try {
    await dismiss(current.id)
    await router.replace(to)
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
      await router.replace({ name: 'send-review' })
    } else if (retry === 'receive') {
      await router.replace({ name: 'receive' })
    }
  } finally {
    acting.value = false
  }
}
</script>

<template>
  <div v-if="record && context" class="flex h-full flex-col">
    <div class="flex-1 space-y-4 overflow-y-auto p-5">
      <div class="flex flex-col items-center gap-3 pt-4 text-center">
        <span
          :class="[
            'flex size-12 items-center justify-center rounded-full',
            notSent ? 'bg-destructive/10 text-destructive' : 'bg-warning/15 text-warning',
          ]"
        >
          <XCircleIcon v-if="notSent" class="size-6" />
          <AlertTriangleIcon v-else class="size-6" />
        </span>
        <h1 class="text-lg font-semibold">
          {{
            notSent ? "Previous transaction wasn't sent" : 'Previous transaction may have been sent'
          }}
        </h1>
        <p class="text-sm text-muted-foreground">
          <template v-if="notSent">
            The {{ place }} closed while generating PoW, so nothing was published. No funds left
            your account.<template v-if="context.origin">
              The site was told the request failed.</template
            >
          </template>
          <template v-else-if="record.detached">
            The node didn't confirm this transaction in time, and it may still go through. Check
            Activity before you try again, so you don't send it twice.
          </template>
          <template v-else>
            The {{ place }} closed while the transaction was being published. Check Activity before
            you try again, so you don't send it twice.
          </template>
        </p>
      </div>

      <dl
        class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 rounded-lg border bg-card p-3 text-sm"
      >
        <template v-if="amountText !== null">
          <dt class="text-ledger text-muted-foreground">Amount</dt>
          <dd>
            <span class="font-mono tabular-nums">{{ amountText }} {{ context.symbol }}</span>
          </dd>
        </template>
        <dt class="text-ledger text-muted-foreground">From</dt>
        <dd class="font-mono">{{ shortAddress(context.from) }}</dd>
        <template v-if="context.recipient">
          <dt class="text-ledger text-muted-foreground">To</dt>
          <dd class="font-mono">{{ shortAddress(context.recipient) }}</dd>
        </template>
        <dt class="text-ledger text-muted-foreground">Started</dt>
        <dd>
          {{ relativeTime(record.startedAt) }} ·
          {{ notSent ? 'stopped during PoW' : 'stopped during publishing' }}
        </dd>
        <template v-if="context.origin">
          <dt class="text-ledger text-muted-foreground">Requested</dt>
          <dd>Requested by {{ context.origin }}</dd>
        </template>
      </dl>

      <p
        v-if="notSent"
        class="rounded-lg border bg-muted px-3 py-2.5 text-xs text-muted-foreground"
      >
        Keep the {{ place }} open during PoW, or get plasma so sends don't need it.
      </p>
      <p v-if="otherAccount" class="text-xs text-muted-foreground">
        Sent from {{ shortAddress(context.from) }}. Switch to that account to try again.
      </p>
    </div>

    <footer class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <template v-if="notSent">
        <Button variant="outline" :disabled="acting" @click="leave('/')">Dismiss</Button>
        <Button v-if="target" :disabled="acting" @click="tryAgain">Try again</Button>
        <Button v-else :disabled="acting" @click="leave('/')">Back to wallet</Button>
      </template>
      <template v-else>
        <Button variant="outline" :disabled="acting" @click="leave('/')">Back to wallet</Button>
        <Button :disabled="acting" @click="leave({ name: 'home', query: { tab: 'activity' } })">
          Check activity
        </Button>
      </template>
    </footer>
  </div>
</template>

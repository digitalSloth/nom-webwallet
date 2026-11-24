<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { trackRejected, useAccount, useNetwork, useTransaction, useWallet } from '@/core'
import { Address, Alert, Button, Spinner, TokenIcon } from 'nom-ui'
import { PublishRejectedError, SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import PageHeader from '../components/PageHeader.vue'
import PlasmaNotice from '../components/PlasmaNotice.vue'
import { trackSend } from '@/shared/lib/unresolved-send'
import { formatAmount, parseAmount } from '@/shared/lib/amount'
import { shortAddress, urlHost } from '@/shared/lib/format'
import { confirmRequest, senderChanged, sendDraft } from '@/shared/lib/send-draft'

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const transaction = useTransaction()
const network = useNetwork()

const draft = sendDraft.value
if (!draft) void router.replace({ name: 'send' })

const amountRaw = draft ? parseAmount(draft.amount, draft.decimals) : null
const submitting = ref(false)
const unknownOutcome = ref(false)
trackSend(submitting, unknownOutcome)
let sent = false

// Leaving mid-send would let a second Confirm queue the same transfer again.
onBeforeRouteLeave(() => !submitting.value || sent)
const error = ref<string | null>(null)

// The draft was reviewed for another account than the active one.
const senderMoved = computed(() => draft !== null && senderChanged(draft, active()))

const accountLabel = computed(
  () => wallet.activeWallet.value?.accounts.find((a) => a.address === active())?.label ?? 'Account'
)

const balance = computed(() => {
  const row = account.balances.value.find((b) => b.tokenStandard === draft?.tokenStandard)
  return row ? BigInt(row.balance) : null
})

const remaining = computed(() => {
  if (balance.value === null || amountRaw === null || !draft) return null
  const left = balance.value - amountRaw
  return left >= 0n ? formatAmount(left, draft.decimals) : null
})

async function confirm(): Promise<void> {
  const activeWallet = wallet.activeWallet.value
  const req = confirmRequest(draft, active())
  if (!draft || !req || !activeWallet) return
  const { context } = req
  if (balance.value !== null && req.amount > balance.value) {
    error.value = 'Insufficient balance'
    return
  }
  submitting.value = true
  error.value = null
  // The draft is gone once Confirm starts, so no screen can resend it by accident.
  sendDraft.value = null
  try {
    const block = await transaction.sendTransaction(
      activeWallet,
      req.from,
      req.recipient,
      req.tokenStandard,
      req.amount,
      context
    )
    sent = true
    await router.replace({ name: 'tx', params: { hash: block.hash.toString() } })
  } catch (err) {
    if (err instanceof PublishRejectedError) {
      sendDraft.value = draft
      const id = trackRejected({
        label: context.title,
        address: req.from,
        meta: context,
        reason: err.reason,
        node: urlHost(network.currentNode.value),
      })
      sent = true
      await router.replace({ name: 'tx', params: { hash: id } })
      return
    }
    error.value = err instanceof Error ? err.message : 'Failed to send transaction'
    // After a timeout the send may still publish, so the draft stays cleared.
    if (error.value === SEND_TIMEOUT_MESSAGE) unknownOutcome.value = true
    else sendDraft.value = draft
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="draft" class="flex h-full flex-col">
    <PageHeader
      title="Review send"
      :back-disabled="submitting"
      @back="router.push({ name: 'send' })"
    />

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="flex items-center gap-3 rounded-lg border bg-card px-3 py-3">
        <TokenIcon :symbol="draft.symbol" class="size-9" />
        <div>
          <div class="text-ledger text-muted-foreground">You send</div>
          <span class="font-mono text-xl font-semibold tabular-nums">
            {{ draft.amount }} {{ draft.symbol }}
          </span>
        </div>
      </div>

      <dl class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-sm">
        <dt class="text-ledger text-muted-foreground">To</dt>
        <dd><Address :address="draft.recipient" :start="10" :end="8" copy /></dd>
        <dt class="text-ledger text-muted-foreground">From</dt>
        <dd>
          {{ accountLabel }}
          <span v-if="active()" class="font-mono text-muted-foreground">
            {{ shortAddress(active()!) }}
          </span>
        </dd>
        <dt class="text-ledger text-muted-foreground">Fee</dt>
        <dd>0</dd>
        <template v-if="remaining !== null">
          <dt class="text-ledger text-muted-foreground">Remaining</dt>
          <dd>{{ remaining }} {{ draft.symbol }}</dd>
        </template>
      </dl>

      <PlasmaNotice :level="account.plasmaLevel.value" />
      <Alert v-if="senderMoved" variant="destructive" class="text-sm">
        The active account changed in another tab or window. Review this send from
        {{ accountLabel }} before confirming.
      </Alert>
      <Alert v-if="error" variant="destructive" class="text-sm">{{ error }}</Alert>
    </div>

    <footer class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <Button variant="outline" :disabled="submitting" @click="router.push({ name: 'send' })">
        Edit
      </Button>
      <Button
        v-if="unknownOutcome"
        @click="router.replace({ name: 'home', query: { tab: 'activity' } })"
      >
        Check activity
      </Button>
      <Button v-else :disabled="submitting || senderMoved" @click="confirm">
        <template v-if="submitting"><Spinner /> Sending…</template>
        <template v-else>Confirm &amp; send</template>
      </Button>
    </footer>
  </div>
</template>

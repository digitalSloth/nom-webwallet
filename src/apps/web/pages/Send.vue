<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import {
  trackRejected,
  useAccount,
  useNetwork,
  useRecentRecipients,
  useTransaction,
  useWallet,
} from '@/core'
import { Address, Alert, Amount, Button, Input, Spinner, TokenIcon } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import { PublishRejectedError, SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import type { BalanceInfo } from '@/types'
import { trackSend } from '@/shared/lib/unresolved-send'
import { amountShare, formatAmount, isValidAddress, parseAmount } from '@/shared/lib/amount'
import { explorerAccountUrl, shortAddress, urlHost } from '@/shared/lib/format'
import {
  confirmRequest,
  keepSendForm,
  senderChanged,
  sendDraft,
  sendFormStash,
  takeSendFormStash,
} from '@/shared/lib/send-draft'
import type { SendDraft } from '@/shared/lib/send-draft'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const transaction = useTransaction()
const network = useNetwork()
const { recipients: recent } = useRecentRecipients(active)

function labelOf(address: string): string {
  for (const w of wallet.wallets.value) {
    const found = w.accounts.find((a) => a.address === address)
    if (found) return found.label || `Account ${found.index + 1}`
  }
  return shortAddress(address)
}

const tokens = computed(() => account.balances.value.filter((b) => BigInt(b.balance) > 0n))
const token = ref<BalanceInfo | null>(null)

// A stash from leaving for the plasma page wins over the draft; it is used once, for its own account.
const stash = takeSendFormStash(active())
const saved = stash ? null : sendDraft.value
const queryToken = typeof route.query.token === 'string' ? route.query.token : undefined
const initialTokenStandard = stash?.tokenStandard ?? saved?.tokenStandard ?? queryToken
const amount = ref(stash?.amount ?? saved?.amount ?? '')
const recipient = ref(stash?.recipient ?? saved?.recipient ?? '')
// The account the form is reviewed for; it moves only when the user re-binds it.
const from = ref<string | null>(saved?.from ?? active())

const submitting = ref(false)
const unknownOutcome = ref(false)
trackSend(submitting, unknownOutcome)
const unknownFrom = ref('')
const error = ref<string | null>(null)
let sent = false

// Leaving mid-send would let a second Confirm queue the same transfer again.
onBeforeRouteLeave((to) => {
  if (submitting.value && !sent) return false
  if (to.name !== 'plasma') return
  const address = active()
  if (!address) return
  sendFormStash.value = {
    address,
    tokenStandard: token.value?.tokenStandard ?? null,
    amount: amount.value,
    recipient: recipient.value,
  }
})

// A send in flight or of unknown outcome is never offered again.
onBeforeUnmount(() => {
  const address = active()
  if (submitting.value || unknownOutcome.value || !address) return
  keepSendForm(route.name, {
    address,
    tokenStandard: token.value?.tokenStandard ?? null,
    amount: amount.value,
    recipient: recipient.value,
  })
})

// Keep the chosen token across balance reloads, rebinding to the fresh row.
// The default token (ZNN, else the first) is picked only when no token was asked for. A token
// that leaves the list clears the selection instead of swapping to another one.
const wantedStandard = ref<string | undefined>(initialTokenStandard)
watch(
  tokens,
  (list) => {
    const standard = token.value?.tokenStandard ?? wantedStandard.value
    if (standard) {
      token.value = list.find((t) => t.tokenStandard === standard) ?? null
      return
    }
    token.value = list.find((t) => t.symbol === 'ZNN') ?? list[0] ?? null
    wantedStandard.value = token.value?.tokenStandard
  },
  { immediate: true }
)

function selectToken(t: BalanceInfo): void {
  token.value = t
  wantedStandard.value = t.tokenStandard
}

const tokenMissing = computed(
  () => wantedStandard.value !== undefined && token.value === null && tokens.value.length > 0
)

const balance = computed(() => (token.value ? BigInt(token.value.balance) : null))

const parsed = computed(() =>
  token.value && amount.value.trim() !== '' ? parseAmount(amount.value, token.value.decimals) : null
)

const amountError = computed(() => {
  if (!token.value || amount.value.trim() === '') return null
  if (parsed.value === null) return `Enter a valid amount (up to ${token.value.decimals} decimals)`
  if (parsed.value === 0n) return 'Enter an amount above 0'
  if (balance.value !== null && parsed.value > balance.value) return 'Insufficient balance'
  return null
})

const recipientError = computed(() =>
  recipient.value.trim() !== '' && !isValidAddress(recipient.value.trim())
    ? 'Enter a valid z1 address'
    : null
)

// What the review panel shows and Confirm publishes.
const draft = computed<SendDraft | null>(() => {
  const t = token.value
  const p = parsed.value
  if (!t || from.value === null || p === null || p <= 0n || p > BigInt(t.balance)) return null
  if (!isValidAddress(recipient.value.trim())) return null
  return {
    tokenStandard: t.tokenStandard,
    symbol: t.symbol ?? '',
    decimals: t.decimals,
    amount: formatAmount(p, t.decimals),
    recipient: recipient.value.trim(),
    from: from.value,
  }
})

const moved = computed(() => from.value !== null && senderChanged({ from: from.value }, active()))
const activeLabel = computed(() => {
  const address = active()
  return address ? labelOf(address) : 'the active account'
})

const remaining = computed(() =>
  draft.value && balance.value !== null && parsed.value !== null
    ? formatAmount(balance.value - parsed.value, draft.value.decimals)
    : null
)

const canConfirm = computed(
  () =>
    draft.value !== null &&
    !moved.value &&
    !network.nodeDown.value &&
    !submitting.value &&
    !unknownOutcome.value
)

const ownAccounts = computed(() =>
  (wallet.activeWallet.value?.accounts ?? []).filter((a) => !a.hidden && a.address !== from.value)
)

function share(percent: bigint): void {
  if (balance.value === null || !token.value) return
  amount.value = amountShare(balance.value, percent, token.value.decimals)
}

async function confirm(): Promise<void> {
  const current = draft.value
  if (submitting.value) return
  const req = confirmRequest(current, active())
  if (!current || !req) return
  wallet.refreshLockState()
  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    // The locked overlay shows; the form comes back from the draft after unlock.
    sendDraft.value = current
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
      req.context
    )
    sent = true
    await router.replace({ name: 'tx', params: { hash: block.hash.toString() } })
  } catch (err) {
    if (err instanceof PublishRejectedError) {
      sendDraft.value = current
      const id = trackRejected({
        label: req.context.title,
        address: req.from,
        meta: req.context,
        reason: err.reason,
        node: urlHost(network.currentNode.value),
      })
      sent = true
      await router.replace({ name: 'tx', params: { hash: id } })
      return
    }
    error.value = err instanceof Error ? err.message : 'Failed to send transaction'
    // After a timeout the send may still publish, so the draft stays cleared.
    if (error.value === SEND_TIMEOUT_MESSAGE) {
      unknownOutcome.value = true
      unknownFrom.value = req.from
    } else sendDraft.value = current
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Send</h1>
      <p v-if="active()" class="text-sm text-muted-foreground">
        From {{ labelOf(active()!) }} ·
        <span class="font-mono">{{ shortAddress(active()!) }}</span>
      </p>
    </div>

    <div v-if="!active()" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div
      v-else-if="!account.isLoading.value && tokens.length === 0"
      class="py-12 text-center text-sm text-muted-foreground"
    >
      No tokens available to send
    </div>

    <div v-else class="flex flex-wrap items-start gap-5">
      <form
        class="flex min-w-0 flex-[3_1_480px] flex-col gap-6 rounded-xl border bg-card p-6"
        @submit.prevent
      >
        <fieldset :disabled="submitting" class="m-0 flex flex-col gap-6 border-0 p-0">
          <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
            <legend class="pb-2 text-ledger text-muted-foreground">Token</legend>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              <label
                v-for="t in tokens"
                :key="t.tokenStandard"
                :class="[
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5',
                  token?.tokenStandard === t.tokenStandard
                    ? 'border-primary bg-accent'
                    : 'border-border',
                ]"
              >
                <input
                  type="radio"
                  name="token"
                  :value="t.tokenStandard"
                  :checked="token?.tokenStandard === t.tokenStandard"
                  class="sr-only"
                  @change="selectToken(t)"
                />
                <TokenIcon :symbol="t.symbol ?? '?'" class="size-7" />
                <span class="flex min-w-0 flex-col">
                  <span class="text-sm font-semibold">{{ t.symbol }}</span>
                  <Amount
                    :value="formatAmount(BigInt(t.balance), t.decimals)"
                    :decimals="Math.min(t.decimals, 2)"
                    class="text-xs text-muted-foreground"
                  />
                </span>
              </label>
            </div>
            <p v-if="tokenMissing" class="text-xs text-destructive">
              This token is not available in {{ activeLabel }}.
            </p>
          </fieldset>

          <div class="flex flex-col gap-2">
            <span class="flex items-baseline justify-between">
              <label for="web-send-amount" class="text-ledger text-muted-foreground">Amount</label>
              <span v-if="token && balance !== null" class="text-xs text-muted-foreground">
                Available
                <span class="font-mono tabular-nums">{{
                  formatAmount(balance, token.decimals)
                }}</span>
                {{ token.symbol }}
              </span>
            </span>
            <Input
              id="web-send-amount"
              v-model="amount"
              numeric
              placeholder="0"
              autocomplete="off"
              class="h-14 text-2xl"
            />
            <p v-if="amountError" class="text-xs text-destructive">{{ amountError }}</p>
            <div class="flex flex-wrap gap-1.5">
              <Button type="button" variant="secondary" size="xs" @click="share(25n)">25%</Button>
              <Button type="button" variant="secondary" size="xs" @click="share(50n)">50%</Button>
              <Button type="button" variant="secondary" size="xs" @click="share(75n)">75%</Button>
              <Button type="button" variant="secondary" size="xs" @click="share(100n)">Max</Button>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <label for="web-send-recipient" class="text-ledger text-muted-foreground">
              Recipient address
            </label>
            <Input
              id="web-send-recipient"
              v-model="recipient"
              placeholder="z1…"
              autocomplete="off"
              spellcheck="false"
              class="font-mono"
            />
            <p v-if="recipientError" class="text-xs text-destructive">{{ recipientError }}</p>
            <span class="text-xs text-muted-foreground">
              <template v-if="ownAccounts.length > 0">
                Your accounts:
                <template v-for="(a, i) in ownAccounts" :key="a.address">
                  <span v-if="i > 0"> · </span>
                  <button type="button" class="font-mono text-info" @click="recipient = a.address">
                    {{ a.label || `Account ${a.index + 1}` }}
                  </button>
                </template>
                <template v-if="recent.length > 0"> · </template>
              </template>
              <template v-if="recent.length > 0">
                Recent:
                <template v-for="(address, i) in recent" :key="address">
                  <span v-if="i > 0"> · </span>
                  <button type="button" class="font-mono text-info" @click="recipient = address">
                    {{ shortAddress(address) }}
                  </button>
                </template>
              </template>
            </span>
          </div>
        </fieldset>
      </form>

      <aside
        aria-labelledby="web-send-review"
        class="flex min-w-0 flex-[2_1_320px] flex-col gap-4 rounded-xl border bg-card p-6 shadow-md"
      >
        <h2 id="web-send-review" class="text-base font-semibold">Review</h2>

        <Alert v-if="moved" variant="destructive" class="space-y-2 text-sm">
          <p>
            The active account changed after this send was reviewed. Review this send from
            {{ activeLabel }} before confirming.
          </p>
          <Button type="button" variant="outline" size="sm" @click="from = active()">
            Use {{ activeLabel }}
          </Button>
        </Alert>

        <div class="flex flex-col gap-1 rounded-lg bg-muted p-4">
          <span class="text-ledger text-muted-foreground">You send</span>
          <span class="font-mono text-2xl font-semibold tabular-nums">
            <template v-if="draft">{{ draft.amount }} {{ draft.symbol }}</template>
            <template v-else>—</template>
          </span>
        </div>

        <dl class="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
          <dt class="self-center text-ledger text-muted-foreground">To</dt>
          <dd class="m-0">
            <Address v-if="draft" :address="draft.recipient" :start="10" :end="8" copy />
            <template v-else>—</template>
          </dd>
          <dt class="self-center text-ledger text-muted-foreground">From</dt>
          <dd class="m-0">{{ draft ? labelOf(draft.from) : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Fee</dt>
          <dd class="m-0 font-mono">0 ZNN</dd>
          <template v-if="!moved">
            <dt class="self-center text-ledger text-muted-foreground">Remaining</dt>
            <dd class="m-0 font-mono tabular-nums">
              <template v-if="draft && remaining !== null">
                {{ remaining }} {{ draft.symbol }}
              </template>
              <template v-else>—</template>
            </dd>
          </template>
        </dl>

        <div
          v-if="account.plasmaLevel.value === 'high'"
          class="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px]"
        >
          <span class="size-2 rounded-full bg-success" />
          Plasma high · sends instantly, no PoW
        </div>
        <div
          v-else
          class="flex flex-col gap-1.5 rounded-lg border border-warning p-3 text-[13px] leading-normal"
        >
          <span class="font-semibold">Needs PoW · usually under a minute</span>
          <span class="text-muted-foreground">
            Low plasma, so this device generates PoW first. The wallet is blocked until the
            transaction is sent; closing the tab cancels it.
          </span>
          <RouterLink :to="{ name: 'plasma' }" class="font-medium text-info">
            Get plasma instead
          </RouterLink>
        </div>

        <Alert v-if="error && !unknownOutcome" variant="destructive" class="text-sm">{{
          error
        }}</Alert>

        <template v-if="unknownOutcome">
          <Alert variant="destructive" class="text-sm">{{ SEND_TIMEOUT_MESSAGE }}</Alert>
          <Button as-child size="lg" class="w-full">
            <RouterLink v-if="unknownFrom === active()" :to="{ name: 'activity' }">
              Check activity
            </RouterLink>
            <a
              v-else
              :href="explorerAccountUrl(unknownFrom)"
              target="_blank"
              rel="noopener noreferrer"
            >
              Check activity
            </a>
          </Button>
        </template>
        <Button
          v-else
          size="lg"
          class="h-auto min-h-10 w-full py-2 text-center whitespace-normal"
          :disabled="!canConfirm"
          @click="confirm"
        >
          <template v-if="submitting"><Spinner /> Sending…</template>
          <template v-else-if="draft"
            >Confirm &amp; send {{ draft.amount }} {{ draft.symbol }}</template
          >
          <template v-else>Confirm &amp; send</template>
        </Button>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useAccount, useRecentRecipients, useWallet } from '@/core'
import { Button, Input } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import type { BalanceInfo } from '@/types'
import PageHeader from '../components/PageHeader.vue'
import PlasmaNotice from '../components/PlasmaNotice.vue'
import TokenPicker from '../components/TokenPicker.vue'
import { formatAmount, isValidAddress, parseAmount } from '@/shared/lib/amount'
import { shortAddress } from '@/shared/lib/format'
import { keepSendForm, sendDraft, sendFormStash, takeSendFormStash } from '@/shared/lib/send-draft'

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const { recipients: recent } = useRecentRecipients(active)

const accountLabel = computed(
  () => wallet.activeWallet.value?.accounts.find((a) => a.address === active())?.label ?? 'Account'
)

const tokens = computed(() => account.balances.value.filter((b) => BigInt(b.balance) > 0n))
const token = ref<BalanceInfo | null>(null)
// A stash from leaving for the plasma page wins over the draft; it is used once, for its own account.
const restored = takeSendFormStash(active())
const initialTokenStandard = restored ? restored.tokenStandard : sendDraft.value?.tokenStandard
const amount = ref(restored?.amount ?? sendDraft.value?.amount ?? '')
const recipient = ref(restored?.recipient ?? sendDraft.value?.recipient ?? '')

const route = useRoute()
// The page remounts on an account switch, so the form belongs to this account.
const typedFor = active()
onBeforeUnmount(() =>
  keepSendForm(
    route.name,
    typedFor
      ? {
          address: typedFor,
          tokenStandard: token.value?.tokenStandard ?? null,
          amount: amount.value,
          recipient: recipient.value,
        }
      : null
  )
)

onBeforeRouteLeave((to) => {
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

// Keep the chosen token across balance reloads, rebinding to the fresh row.
watch(
  tokens,
  (list) => {
    const standard = token.value?.tokenStandard ?? initialTokenStandard
    token.value =
      list.find((t) => t.tokenStandard === standard) ??
      list.find((t) => t.symbol === 'ZNN') ??
      list[0] ??
      null
  },
  { immediate: true }
)

const parsed = computed(() =>
  token.value && amount.value.trim() !== '' ? parseAmount(amount.value, token.value.decimals) : null
)

const amountError = computed(() => {
  if (!token.value || amount.value.trim() === '') return null
  if (parsed.value === null) return `Enter a valid amount (up to ${token.value.decimals} decimals)`
  if (parsed.value === 0n) return 'Enter an amount above 0'
  if (parsed.value > BigInt(token.value.balance)) return 'Insufficient balance'
  return null
})

const recipientError = computed(() =>
  recipient.value.trim() !== '' && !isValidAddress(recipient.value.trim())
    ? 'Enter a valid z1 address'
    : null
)

const canReview = computed(
  () =>
    token.value !== null &&
    parsed.value !== null &&
    amountError.value === null &&
    recipient.value.trim() !== '' &&
    recipientError.value === null
)

function setMax(): void {
  if (token.value) amount.value = formatAmount(BigInt(token.value.balance), token.value.decimals)
}

function cancel(): void {
  sendDraft.value = null
  void router.push('/')
}

function review(): void {
  const address = active()
  if (!token.value || parsed.value === null || !address) return
  sendDraft.value = {
    tokenStandard: token.value.tokenStandard,
    symbol: token.value.symbol ?? '',
    decimals: token.value.decimals,
    amount: formatAmount(parsed.value, token.value.decimals),
    recipient: recipient.value.trim(),
    from: address,
  }
  void router.push({ name: 'send-review' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Send" top-level>
      <span v-if="active()" class="font-mono text-xs text-muted-foreground">
        {{ accountLabel }} · {{ shortAddress(active()!) }}
      </span>
    </PageHeader>

    <div v-if="!active()" class="flex-1 py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div
      v-else-if="!account.isLoading.value && tokens.length === 0"
      class="flex-1 py-12 text-center text-sm text-muted-foreground"
    >
      No tokens available to send
    </div>

    <div v-else class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <TokenPicker v-model="token" :tokens="tokens" />

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="send-amount" class="text-ledger text-muted-foreground">Amount</label>
          <button type="button" class="text-xs font-medium text-info" @click="setMax">Max</button>
        </div>
        <Input
          id="send-amount"
          v-model="amount"
          numeric
          placeholder="0"
          autocomplete="off"
          class="h-12 text-xl"
        />
        <p v-if="amountError" class="text-xs text-destructive">{{ amountError }}</p>
      </div>

      <div class="space-y-1.5">
        <label for="send-recipient" class="text-ledger text-muted-foreground">Recipient</label>
        <Input
          id="send-recipient"
          v-model="recipient"
          placeholder="z1…"
          autocomplete="off"
          spellcheck="false"
          class="font-mono"
        />
        <p v-if="recipientError" class="text-xs text-destructive">{{ recipientError }}</p>
        <div v-if="recent.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span class="text-muted-foreground">Recent:</span>
          <button
            v-for="address in recent"
            :key="address"
            type="button"
            class="font-mono text-info"
            @click="recipient = address"
          >
            {{ shortAddress(address) }}
          </button>
        </div>
      </div>

      <PlasmaNotice :level="account.plasmaLevel.value" />
    </div>

    <footer class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <Button variant="outline" @click="cancel">Cancel</Button>
      <Button :disabled="!canReview" @click="review">Review</Button>
    </footer>
  </div>
</template>

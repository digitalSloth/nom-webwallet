<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LockIcon } from 'lucide-vue-next'
import { Badge, Button, Input } from 'nom-ui'
import { useApprovalControls, useDappApprovals, useWallet } from '@/core'
import AccountPicker from '@/shared/approval/AccountPicker.vue'
import ApprovalFrame from './ApprovalFrame.vue'
import ConnectScreen from '@/shared/approval/ConnectScreen.vue'
import EncryptedMessageScreen from '@/shared/approval/EncryptedMessageScreen.vue'
import MessageAccessScreen from '@/shared/approval/MessageAccessScreen.vue'
import ResultScreen from './ResultScreen.vue'
import SignScreen from '@/shared/approval/SignScreen.vue'
import TransactionScreen from '@/shared/approval/TransactionScreen.vue'

defineProps<{ closeLabel: string }>()
const emit = defineEmits<{ close: [] }>()
const result = defineModel<string | null>('result', { required: true })

const wallet = useWallet()
const {
  currentApproval,
  pendingCount,
  queuePosition,
  accountMismatch,
  needsUnlockPrompt,
  isBusy,
  changeConnectAccount,
} = useDappApprovals()
const {
  password,
  unlockError,
  isUnlocking,
  unlockTarget,
  actionsDisabled,
  handlePrimary,
  handleReject,
  restartCooldown,
} = useApprovalControls()

// True while a message to sign or send is not fully scrolled into view.
const messageUnread = ref(false)

// The connect request the account picker was opened for.
const pickerFor = ref<string | null>(null)
const changeRefused = ref(false)

watch(
  () => currentApproval.value?.id,
  () => {
    pickerFor.value = null
    changeRefused.value = false
  }
)

function openPicker(): void {
  pickerFor.value = currentApproval.value?.id ?? null
  changeRefused.value = false
}

async function pick(address: string): Promise<void> {
  const id = pickerFor.value
  pickerFor.value = null
  if (id === null) return
  if (address === currentApproval.value?.account && !accountMismatch.value) return
  changeRefused.value = (await changeConnectAccount(id, address)) === 'refused'
}

const title = computed(() => {
  const kind = currentApproval.value?.action.kind
  if (kind === 'connect') return 'Connect request'
  if (kind === 'sendBlock') return 'Transaction request'
  if (kind === 'messageAccess') return 'Message access'
  if (kind === 'sendMessage') return 'Encrypted message'
  return 'Sign message'
})

const accountLabel = computed(() => {
  const account = currentApproval.value?.account
  return wallet.activeWallet.value?.accounts.find((a) => a.address === account)?.label ?? null
})

const primaryLabel = computed(() => {
  if (isUnlocking.value) return 'Unlocking…'
  const kind = currentApproval.value?.action.kind
  const verb =
    kind === 'connect'
      ? 'connect'
      : kind === 'sendBlock'
        ? 'approve'
        : kind === 'messageAccess'
          ? 'allow'
          : kind === 'sendMessage'
            ? 'send'
            : 'sign'
  if (needsUnlockPrompt.value) return `Unlock & ${verb}`
  return verb.charAt(0).toUpperCase() + verb.slice(1)
})

const nextLabel = computed(() =>
  pendingCount.value > 0
    ? `Next request · ${queuePosition.value.index} of ${queuePosition.value.total}`
    : null
)

async function primary(): Promise<void> {
  if (pickerFor.value !== null || messageUnread.value) return
  const sent = await handlePrimary()
  if (sent) result.value = sent.hash
}

function next(): void {
  result.value = null
  restartCooldown()
}

function close(): void {
  result.value = null
  emit('close')
}
</script>

<template>
  <ResultScreen
    v-if="result !== null"
    :hash="result"
    :next-label="nextLabel"
    :close-label="closeLabel"
    @next="next"
    @close="close"
  >
    <template v-if="$slots['result-actions']" #actions>
      <slot name="result-actions" />
    </template>
  </ResultScreen>

  <ApprovalFrame v-else-if="currentApproval" :title="title">
    <template #aside>
      <Badge v-if="queuePosition.total > 1" variant="pending">
        {{ queuePosition.index }} of {{ queuePosition.total }}
      </Badge>
    </template>

    <AccountPicker
      v-if="currentApproval.action.kind === 'connect' && pickerFor !== null"
      :key="currentApproval.id"
      :selected="currentApproval.account"
      :disabled="isBusy"
      @pick="pick"
      @close="pickerFor = null"
    />
    <ConnectScreen
      v-else-if="currentApproval.action.kind === 'connect'"
      :key="currentApproval.id"
      :approval="currentApproval"
      :account-label="accountLabel"
      :change-disabled="isBusy"
      @change="openPicker"
    />
    <MessageAccessScreen
      v-else-if="currentApproval.action.kind === 'messageAccess'"
      :key="currentApproval.id"
      :approval="currentApproval"
      :account-label="accountLabel"
    />
    <EncryptedMessageScreen
      v-else-if="currentApproval.action.kind === 'sendMessage'"
      :key="currentApproval.id"
      :approval="currentApproval"
      :account-label="accountLabel"
      @unread="messageUnread = $event"
    />
    <SignScreen
      v-else-if="currentApproval.action.kind === 'signMessage'"
      :key="currentApproval.id"
      :approval="currentApproval"
      :account-label="accountLabel"
      @unread="messageUnread = $event"
    />
    <TransactionScreen
      v-else
      :key="currentApproval.id"
      :approval="currentApproval"
      :account-label="accountLabel"
      @unread="messageUnread = $event"
    />

    <p
      v-if="changeRefused && currentApproval.action.kind === 'connect'"
      role="alert"
      class="text-sm font-medium text-destructive"
    >
      Couldn't switch to that account.
    </p>

    <p v-if="accountMismatch" role="alert" class="text-sm font-medium text-destructive">
      This request is for the account shown above, which is not the active account in this window.
      Switch to it before you approve.
    </p>

    <template #footer>
      <form
        v-if="needsUnlockPrompt && unlockTarget"
        class="flex flex-col gap-1.5"
        @submit.prevent="primary"
      >
        <label
          for="approval-password"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LockIcon class="size-3" aria-hidden="true" />
          {{ unlockTarget.name }} is locked · password
        </label>
        <Input
          id="approval-password"
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          autocapitalize="off"
          spellcheck="false"
          placeholder="Enter password"
          autofocus
          :disabled="isUnlocking"
        />
        <p v-if="unlockError" role="alert" class="text-xs text-destructive">{{ unlockError }}</p>
      </form>

      <div class="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" :disabled="actionsDisabled" @click="handleReject">
          Reject
        </Button>
        <Button
          size="lg"
          :disabled="actionsDisabled || pickerFor !== null || messageUnread"
          @click="primary"
          >{{ primaryLabel }}</Button
        >
      </div>
    </template>
  </ApprovalFrame>

  <slot v-else name="idle" />
</template>

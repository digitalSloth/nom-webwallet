<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LockIcon } from 'lucide-vue-next'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from 'nom-ui'
import { useApprovalControls, useDappApprovals, useWallet } from '@/core'
import AccountPicker from '@/shared/approval/AccountPicker.vue'
import ConnectScreen from '@/shared/approval/ConnectScreen.vue'
import SignScreen from '@/shared/approval/SignScreen.vue'
import TransactionScreen from '@/shared/approval/TransactionScreen.vue'
import { SHEET_DIALOG } from '../lib/sheet'

const props = defineProps<{ locked: boolean }>()

const router = useRouter()
const wallet = useWallet()
const {
  currentApproval,
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
} = useApprovalControls({ onNeedsUnlock: () => wallet.refreshLockState() })

// True while a message to sign is not fully scrolled into view.
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

// The picker lists every wallet's accounts, so it never stays open over the lock.
watch(
  () => props.locked,
  (locked) => {
    if (locked) pickerFor.value = null
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
  return 'Sign message'
})

const accountLabel = computed(() => {
  const account = currentApproval.value?.account
  return wallet.activeWallet.value?.accounts.find((a) => a.address === account)?.label ?? null
})

const primaryLabel = computed(() => {
  if (isUnlocking.value) return 'Unlocking…'
  const kind = currentApproval.value?.action.kind
  const verb = kind === 'connect' ? 'connect' : kind === 'sendBlock' ? 'approve' : 'sign'
  if (needsUnlockPrompt.value) return `Unlock & ${verb}`
  return verb.charAt(0).toUpperCase() + verb.slice(1)
})

async function primary(): Promise<void> {
  if (pickerFor.value !== null || messageUnread.value) return
  const sent = await handlePrimary()
  if (sent) await router.push({ name: 'tx', params: { hash: sent.hash } })
}
</script>

<template>
  <!-- No close button and no update:open handler: only Reject or approve answers a request. -->
  <Dialog :open="currentApproval !== null">
    <DialogContent
      v-if="currentApproval"
      hide-close
      :class="['gap-4', SHEET_DIALOG]"
      @open-auto-focus.prevent
      @escape-key-down.prevent
      @interact-outside.prevent
    >
      <DialogHeader>
        <div class="flex items-center justify-between gap-2">
          <DialogTitle>{{ title }}</DialogTitle>
          <Badge variant="pending">{{ queuePosition.index }} of {{ queuePosition.total }}</Badge>
        </div>
        <DialogDescription class="sr-only">A site is asking for your approval.</DialogDescription>
      </DialogHeader>

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
        :change-disabled="isBusy || locked"
        end-session-hint="End the session any time in Connected apps."
        @change="openPicker"
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
        v-if="locked && currentApproval.action.kind === 'connect'"
        class="text-xs text-muted-foreground"
      >
        To share a different account, reject this request, unlock the wallet and connect again.
      </p>

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

      <DialogFooter class="grid grid-cols-2 gap-2 sm:flex-none">
        <Button variant="outline" size="lg" :disabled="actionsDisabled" @click="handleReject">
          Reject
        </Button>
        <Button
          size="lg"
          :disabled="actionsDisabled || pickerFor !== null || messageUnread"
          @click="primary"
          >{{ primaryLabel }}</Button
        >
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

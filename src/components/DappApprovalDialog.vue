<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { Buffer } from 'buffer'
import { addNumberDecimals, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import {
  Address,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Separator,
  useToast,
} from 'nom-ui'
import { useDappApprovals, useNetwork, useUnlockTarget, useWallet } from '@/core'
import { useStickyToast } from '@/core/composables/useStickyToast'
import { decodeContractCall } from '@/core/contract-call'
import { encodeMessage, messageSegments } from '@/core/message-guard'

const props = defineProps<{ unlockDialogOpen: boolean }>()

const requestUnlock = inject<(path?: string) => void>('requestUnlock', () => {})

const network = useNetwork()
const wallet = useWallet()
const toast = useToast()
const refusalToast = useStickyToast(toast.toast)
const {
  currentApproval,
  pendingCount,
  isBusy,
  notice,
  accountMismatch,
  needsUnlockPrompt,
  approve,
  reject,
} = useDappApprovals()

const isOpen = computed(() => currentApproval.value !== null && !props.unlockDialogOpen)

// --- Inline unlock: the password goes in this dialog, so approving a request
// on a locked wallet is one step rather than a detour through the unlock
// prompt. The target wallet is pinned while the field is shown, so a password
// typed for one wallet is never submitted against another.
const password = ref('')
const unlockError = ref<string | null>(null)
const isUnlocking = ref(false)
const { unlockTarget, pinActiveWallet } = useUnlockTarget(() => {
  password.value = ''
  unlockError.value = null
  if (needsUnlockPrompt.value) pinActiveWallet()
})

watch(
  needsUnlockPrompt,
  (needed) => {
    if (needed) {
      pinActiveWallet()
    } else {
      password.value = ''
      unlockError.value = null
    }
  },
  { immediate: true }
)

watch(password, () => {
  unlockError.value = null
})

const primaryLabel = computed(() => {
  if (!needsUnlockPrompt.value) return 'Approve'
  return isUnlocking.value ? 'Unlocking...' : 'Unlock and approve'
})

// Updated only after the DOM has repainted for a new currentApproval, so it
// always matches what the user can actually see, even during the moment
// between one approval settling and the next one's body finishing its
// render. Approve/Reject act on this id, never on whatever the queue head
// happens to be when the click is handled.
const renderedApprovalId = ref<string | null>(null)

// A rapid double-click can still land on newly-rendered content: Vue's
// scheduler updates `renderedApprovalId` and clears `isBusy` inside the same
// microtask checkpoint that dequeues the previous approval, with no yield to
// the event loop in between. A second click arrives at least a full task
// later (user input is never synchronous with a microtask drain), so by then
// the id guard already matches the *new* head and would let the click
// through. `justChanged` blocks both buttons for a short window after every
// id change so the user has had a moment to actually see what they're
// approving before a click can register.
const COOLDOWN_MS = 750
const justChanged = ref(false)
let cooldownTimer: ReturnType<typeof setTimeout> | null = null

watch(
  currentApproval,
  (val) => {
    renderedApprovalId.value = val?.id ?? null
    if (cooldownTimer) clearTimeout(cooldownTimer)
    justChanged.value = true
    cooldownTimer = setTimeout(() => {
      justChanged.value = false
      cooldownTimer = null
    }, COOLDOWN_MS)
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  if (cooldownTimer) clearTimeout(cooldownTimer)
})

const actionsDisabled = computed(() => isBusy.value || justChanged.value || isUnlocking.value)

async function handlePrimary() {
  if (actionsDisabled.value) return
  refusalToast.dismiss()
  // Captured at the click, so the unlock and the approve both act on the
  // request that was on screen.
  const id = renderedApprovalId.value
  if (!id) return
  if (needsUnlockPrompt.value) {
    const unlocked = await unlockWithPassword()
    if (!unlocked) return
  }
  await approveRendered(id)
}

async function unlockWithPassword(): Promise<boolean> {
  const target = unlockTarget.value
  if (!target) return false
  if (!password.value) {
    unlockError.value = 'Password is required'
    return false
  }
  isUnlocking.value = true
  try {
    await wallet.unlockWallet(target.baseAddress, password.value)
    password.value = ''
    return true
  } catch (error) {
    unlockError.value =
      error instanceof Error
        ? error.message
        : 'Failed to unlock wallet. Please check your password.'
    return false
  } finally {
    isUnlocking.value = false
  }
}

async function approveRendered(id: string) {
  await approve(id)
  if (notice.value === 'accountChanged') {
    // Stays on screen until dismissed: the window has nothing else that
    // explains the refusal.
    refusalToast.showError(
      'The active account or network changed after this request was made, so it was rejected. Ask the site to send it again.'
    )
  } else if (notice.value === 'needsUnlock') {
    toast.show('Unlock the wallet to approve this request.', 'warning')
    requestUnlock()
  }
}

function handleReject() {
  if (actionsDisabled.value) return
  refusalToast.dismiss()
  if (renderedApprovalId.value) reject(renderedApprovalId.value)
}

// A remote icon is fetched from this privileged page, which tells its host
// the user's IP and when the request was shown. So a WalletConnect peer the
// user has not connected to yet gets no icon. An in-page request's icon is
// the tab's favicon, which the browser has already loaded.
const peerIcon = computed<string | null>(() => {
  const approval = currentApproval.value
  if (!approval) return null
  if (approval.surface === 'walletconnect' && approval.action.kind === 'connect') return null
  const icon = approval.peer.icons[0]
  return icon && icon.startsWith('https://') ? icon : null
})

// Rendered with white-space: pre-wrap, and with every invisible or
// reordering code point shown as a U+XXXX label, so the text on screen maps
// one to one onto the bytes that get signed.
const messageParts = computed(() => {
  const action = currentApproval.value?.action
  return action?.kind === 'signMessage' ? messageSegments(action.message) : []
})
const hiddenCharCount = computed(() => messageParts.value.filter((part) => part.hidden).length)

function messageByteLength(message: string): number {
  return encodeMessage(message).length
}

function formatAmount(amount: bigint | string | number, tokenStandard: string): string {
  const isCore = tokenStandard === ZNN_ZTS.toString() || tokenStandard === QSR_ZTS.toString()
  if (isCore) {
    const label = tokenStandard === ZNN_ZTS.toString() ? 'ZNN' : 'QSR'
    return `${addNumberDecimals(amount, 8)} ${label}`
  }
  return `${amount} raw units (${tokenStandard})`
}

// Every byte that will be signed and published, shown alongside any decoded
// view so nothing is hidden at approval time.
function dataHex(data: Uint8Array): string {
  return Buffer.from(data).toString('hex')
}

// Argument values come from the dApp, so they are split into segments the
// same way as a signed message: invisible and reordering code points show as
// U+XXXX labels.
const decodedCall = computed(() => {
  const action = currentApproval.value?.action
  if (action?.kind !== 'sendBlock') return null
  const call = decodeContractCall(action.block.toAddress.toString(), action.block.data)
  if (!call) return null
  return {
    ...call,
    args: call.args.map((arg) => ({ name: arg.name, parts: messageSegments(arg.value) })),
  }
})
</script>

<template>
  <Dialog :open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center justify-between">
          <span>dApp request</span>
          <span v-if="pendingCount > 1" class="text-sm font-normal text-muted-foreground">
            1 of {{ pendingCount }}
          </span>
        </DialogTitle>
      </DialogHeader>

      <template v-if="currentApproval">
        <!-- Peer banner -->
        <div class="flex items-center gap-3 rounded-md bg-muted p-3">
          <img v-if="peerIcon" :src="peerIcon" alt="" class="h-8 w-8 rounded-full" />
          <div class="text-sm">
            <template v-if="currentApproval.surface === 'walletconnect'">
              <p class="font-medium">via WalletConnect</p>
              <p class="text-muted-foreground">{{ currentApproval.peer.name }}</p>
              <p class="text-muted-foreground">{{ currentApproval.origin }}</p>
            </template>
            <template v-else>
              <p class="font-medium" v-if="currentApproval.topFrameHost">
                {{ currentApproval.origin }}, embedded in {{ currentApproval.topFrameHost }}
              </p>
              <p class="font-medium" v-else>{{ currentApproval.origin }}</p>
            </template>
          </div>
        </div>

        <template v-if="currentApproval.surface === 'walletconnect'">
          <p
            v-if="currentApproval.verification === 'invalid'"
            class="text-sm font-medium text-destructive"
          >
            WalletConnect could not match this dApp to {{ currentApproval.origin }}. The request
            may come from a different site. Only approve it if you trust where it came from.
          </p>
          <p
            v-else-if="currentApproval.verification === 'valid'"
            class="text-sm text-muted-foreground"
          >
            WalletConnect verified this dApp's domain.
          </p>
          <p v-else class="text-sm text-muted-foreground">
            WalletConnect could not verify this dApp's domain.
          </p>
        </template>

        <Separator />

        <!-- connect -->
        <div v-if="currentApproval.action.kind === 'connect'" class="space-y-2 text-sm">
          <p>This site wants to view your account:</p>
          <Address :address="currentApproval.account" :copy="false" />
          <p class="text-muted-foreground">
            Chain ID {{ currentApproval.chainId }} · {{ network.currentNode.value }}
          </p>
          <p class="text-muted-foreground">
            The address, chain ID and node URL will be shared without further prompts. Signing a
            message or sending a transaction will always ask you first.
          </p>
        </div>

        <!-- signMessage -->
        <div v-else-if="currentApproval.action.kind === 'signMessage'" class="space-y-2 text-sm">
          <p class="font-medium">Sign this message:</p>
          <!-- Vue drops the whitespace-only text between these tags, so the
               formatting adds nothing to the pre-wrap text. -->
          <p class="rounded-md bg-muted p-3 font-mono break-all whitespace-pre-wrap">
            <template v-for="(part, index) in messageParts" :key="index">
              <span v-if="part.hidden" class="rounded-sm bg-destructive/15 px-0.5 text-destructive">
                {{ part.text }}
              </span>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
          <p v-if="hiddenCharCount > 0" class="font-medium text-destructive">
            This message contains {{ hiddenCharCount }} invisible or control
            {{ hiddenCharCount === 1 ? 'character' : 'characters' }}, highlighted above as U+ codes.
            They are part of what you sign.
          </p>
          <p class="text-muted-foreground">
            {{ messageByteLength(currentApproval.action.message) }} bytes
          </p>
          <Address :address="currentApproval.account" :copy="false" />
          <p class="text-muted-foreground">Signing a message is not a transaction.</p>
        </div>

        <!-- sendBlock: send -->
        <div v-else-if="currentApproval.action.block.blockType === 2" class="space-y-2 text-sm">
          <p class="font-medium">Send</p>
          <Address :address="currentApproval.account" :copy="false" />
          <p class="text-muted-foreground">to</p>
          <Address :address="currentApproval.action.block.toAddress.toString()" :copy="false" />
          <p>
            {{
              formatAmount(
                currentApproval.action.block.amount,
                currentApproval.action.block.tokenStandard.toString()
              )
            }}
          </p>
          <template v-if="currentApproval.action.block.data.length > 0">
            <template v-if="decodedCall">
              <p class="font-medium">
                Contract call: {{ decodedCall.contract }} · {{ decodedCall.method }}
              </p>
              <dl class="space-y-2 rounded-md bg-muted p-3 text-xs">
                <div v-for="arg in decodedCall.args" :key="arg.name">
                  <dt class="text-muted-foreground">{{ arg.name }}</dt>
                  <dd class="font-mono break-all whitespace-pre-wrap">
                    <template v-for="(part, index) in arg.parts" :key="index">
                      <span
                        v-if="part.hidden"
                        class="rounded-sm bg-destructive/15 px-0.5 text-destructive"
                      >
                        {{ part.text }}
                      </span>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </dd>
                </div>
                <p v-if="decodedCall.args.length === 0" class="text-muted-foreground">
                  No arguments
                </p>
              </dl>
              <p class="text-muted-foreground">
                Decoded from the raw data below. Only approve calls you expect from this site.
              </p>
            </template>
            <template v-else>
              <p class="text-muted-foreground">
                Includes {{ currentApproval.action.block.data.length }} bytes of data — this is a
                contract call.
              </p>
              <p class="font-medium text-destructive">
                This wallet cannot decode what this call does. Only approve it if you trust this
                site.
              </p>
            </template>
            <p class="text-muted-foreground">
              Raw data ({{ currentApproval.action.block.data.length }} bytes)
            </p>
            <p class="max-h-40 overflow-y-auto rounded-md bg-muted p-3 font-mono break-all text-xs">
              {{ dataHex(currentApproval.action.block.data) }}
            </p>
          </template>
        </div>

        <!-- sendBlock: receive -->
        <div v-else class="space-y-2 text-sm">
          <p class="font-medium">Receive</p>
          <p class="rounded-md bg-muted p-3 font-mono break-all">
            {{ currentApproval.action.block.fromBlockHash.toString() }}
          </p>
          <Address :address="currentApproval.account" :copy="false" />
        </div>

        <p v-if="accountMismatch" class="text-sm font-medium text-destructive">
          This request is for the account shown above, which is not the active account in this
          window. Switch to it before you approve.
        </p>

        <form
          v-if="needsUnlockPrompt && unlockTarget"
          class="space-y-2"
          @submit.prevent="handlePrimary"
        >
          <Field>
            <FieldLabel for="approval-password">Password for {{ unlockTarget.name }}</FieldLabel>
            <Input
              id="approval-password"
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Enter password"
              :disabled="isUnlocking"
            />
            <p v-if="unlockError" class="text-sm text-destructive">{{ unlockError }}</p>
          </Field>
        </form>
      </template>

      <DialogFooter>
        <Button variant="outline" :disabled="actionsDisabled" @click="handleReject">
          Reject
        </Button>
        <Button :disabled="actionsDisabled" @click="handlePrimary">
          {{ primaryLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

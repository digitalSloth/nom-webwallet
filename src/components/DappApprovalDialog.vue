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
  Separator,
} from 'nom-ui'
import { useDappApprovals, useNetwork, useWallet } from '@/core'
import { encodeMessage } from '@/core/message-guard'

const props = defineProps<{ unlockDialogOpen: boolean }>()

const requestUnlock = inject<(path?: string) => void>('requestUnlock')!

const wallet = useWallet()
const network = useNetwork()
const { currentApproval, pendingCount, isBusy, approve, reject } = useDappApprovals()

const isOpen = computed(() => currentApproval.value !== null && !props.unlockDialogOpen)

const hasActiveWallet = computed(() => wallet.activeWallet.value !== null)
const isLocked = computed(() => !wallet.isActiveWalletUnlocked.value)

const primaryLabel = computed(() =>
  isLocked.value && hasActiveWallet.value ? 'Unlock to continue' : 'Approve'
)

// Updated only after the DOM has repainted for a new currentApproval, so it
// always matches what the user can actually see, even during the moment
// between one approval settling and the next one's body finishing its
// render. Approve/Reject act on this id, never on whatever the queue head
// happens to be when the click is handled.
const renderedApprovalId = ref<string | null>(null)
// Contract-call data starts truncated (see dataPreview below); reset to
// truncated whenever the rendered approval changes so expanding one
// request's data never carries over and hides the next one's length.
const showFullData = ref(false)

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
    showFullData.value = false
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

function handlePrimary() {
  if (isLocked.value && hasActiveWallet.value) {
    requestUnlock()
  } else if (renderedApprovalId.value) {
    approve(renderedApprovalId.value)
  }
}

function handleReject() {
  if (renderedApprovalId.value) reject(renderedApprovalId.value)
}

function peerIcon(icons: string[]): string | null {
  const icon = icons[0]
  return icon && icon.startsWith('https://') ? icon : null
}

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

const DATA_PREVIEW_BYTES = 32

// Not a decode of the call's semantics — just enough of the raw bytes that the
// user isn't approving something entirely opaque. See the contract-call notice
// this accompanies. showFullData lets the user expand to the complete payload.
function dataPreview(data: Uint8Array, full: boolean): string {
  if (full) return Buffer.from(data).toString('hex')
  const hex = Buffer.from(data.subarray(0, DATA_PREVIEW_BYTES)).toString('hex')
  return data.length > DATA_PREVIEW_BYTES ? `${hex}…` : hex
}
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
          <img
            v-if="peerIcon(currentApproval.peer.icons)"
            :src="peerIcon(currentApproval.peer.icons)!"
            alt=""
            class="h-8 w-8 rounded-full"
          />
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

        <Separator />

        <!-- connect -->
        <div v-if="currentApproval.action.kind === 'connect'" class="space-y-2 text-sm">
          <p>This site wants to view your account:</p>
          <Address
            v-if="wallet.activeAccountAddress.value"
            :address="wallet.activeAccountAddress.value"
            :copy="false"
          />
          <p class="text-muted-foreground">
            Chain ID {{ network.chainId.value }} · {{ network.currentNode.value }}
          </p>
          <p class="text-muted-foreground">
            The address, chain ID and node URL will be shared without further prompts. Signing a
            message or sending a transaction will always ask you first.
          </p>
        </div>

        <!-- signMessage -->
        <div v-else-if="currentApproval.action.kind === 'signMessage'" class="space-y-2 text-sm">
          <p class="font-medium">Sign this message:</p>
          <p class="rounded-md bg-muted p-3 font-mono break-all">
            {{ currentApproval.action.message }}
          </p>
          <p class="text-muted-foreground">
            {{ messageByteLength(currentApproval.action.message) }} bytes
          </p>
          <Address
            v-if="wallet.activeAccountAddress.value"
            :address="wallet.activeAccountAddress.value"
            :copy="false"
          />
          <p class="text-muted-foreground">Signing a message is not a transaction.</p>
        </div>

        <!-- sendBlock: send -->
        <div v-else-if="currentApproval.action.block.blockType === 2" class="space-y-2 text-sm">
          <p class="font-medium">Send</p>
          <Address
            v-if="wallet.activeAccountAddress.value"
            :address="wallet.activeAccountAddress.value"
            :copy="false"
          />
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
            <p class="text-muted-foreground">
              Includes {{ currentApproval.action.block.data.length }} bytes of data — this is a
              contract call.
            </p>
            <p class="font-medium text-destructive">
              This wallet cannot decode what this call does. Only approve it if you trust this
              site.
            </p>
            <p
              class="rounded-md bg-muted p-3 font-mono break-all text-xs"
              :class="{ 'max-h-40 overflow-y-auto': showFullData }"
            >
              {{ dataPreview(currentApproval.action.block.data, showFullData) }}
            </p>
            <Button
              v-if="currentApproval.action.block.data.length > DATA_PREVIEW_BYTES"
              variant="link"
              size="sm"
              class="h-auto p-0"
              @click="showFullData = !showFullData"
            >
              {{ showFullData ? 'Show less' : 'Show all' }}
            </Button>
          </template>
        </div>

        <!-- sendBlock: receive -->
        <div v-else class="space-y-2 text-sm">
          <p class="font-medium">Receive</p>
          <p class="rounded-md bg-muted p-3 font-mono break-all">
            {{ currentApproval.action.block.fromBlockHash.toString() }}
          </p>
          <Address
            v-if="wallet.activeAccountAddress.value"
            :address="wallet.activeAccountAddress.value"
            :copy="false"
          />
        </div>
      </template>

      <DialogFooter>
        <Button variant="outline" :disabled="isBusy || justChanged" @click="handleReject">
          Reject
        </Button>
        <Button :disabled="isBusy || justChanged" @click="handlePrimary">
          {{ primaryLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

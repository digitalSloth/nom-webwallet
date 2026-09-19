<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useDappApprovals, useWallet } from '@/core'
import { ZenonService } from '@/core/zenon-service'
import { startInboxBridge } from '@/core/inpage-approval-bridge'
import { APPROVAL_WINDOW_IDLE_MS } from '@/config'
import { Button, Heading, Toaster, TooltipProvider, useTheme, useToast } from 'nom-ui'
import DappApprovalDialog from '@/components/DappApprovalDialog.vue'
import UnlockWalletDialog from '@/components/UnlockWalletDialog.vue'
import { LockIcon } from 'lucide-vue-next'

/**
 * Root of the approval window (approve.html, §1.8). No router, no header, no
 * WalletConnect — this stays light so it never pays for the pieces only the
 * main app needs (Risk 4).
 */

// A fresh page starts locked, and unlocking costs an Argon2 run — this waits
// briefly on an empty-and-locked queue rather than closing (and re-charging
// that cost) the instant the last request settles (§6.6).
const EMPTY_LOCKED_CLOSE_GRACE_MS = 1200
// How often the idle timer checks elapsed time against APPROVAL_WINDOW_IDLE_MS.
const IDLE_CHECK_INTERVAL_MS = 5000

const wallet = useWallet()
const { currentApproval, isBusy } = useDappApprovals()
const { initTheme } = useTheme()
const toast = useToast()

const isReady = ref(false)
const lastOrigin = ref<string | null>(null)

watch(currentApproval, (approval) => {
  if (approval) lastOrigin.value = approval.origin
})

// --- Unlock dialog, matching App.vue's requestUnlock contract ---
const showUnlockDialog = ref(false)
const unlockError = ref<string | null>(null)

function requestUnlock(): void {
  unlockError.value = null
  showUnlockDialog.value = true
}
provide('requestUnlock', requestUnlock)

async function handleQuickUnlock(password: string) {
  if (!wallet.activeWallet.value) return
  try {
    unlockError.value = null
    await wallet.unlockWallet(wallet.activeWallet.value.baseAddress, password)
    toast.show('Wallet unlocked!', 'success')
    showUnlockDialog.value = false
  } catch (error) {
    unlockError.value =
      error instanceof Error ? error.message : 'Failed to unlock wallet. Please check your password.'
  }
}

function handleCancelUnlock(): void {
  showUnlockDialog.value = false
  unlockError.value = null
}

// --- Window lifetime (§6.6) ---
let lastActivityAt = Date.now()
let idleTimer: ReturnType<typeof setInterval> | undefined
let emptyLockedTimer: ReturnType<typeof setTimeout> | undefined

function noteActivity(): void {
  lastActivityAt = Date.now()
}

function lockAndClose(): void {
  if (wallet.activeWallet.value && wallet.isActiveWalletUnlocked.value) {
    wallet.lockWallet(wallet.activeWallet.value.baseAddress)
  }
  window.close()
}

watch([currentApproval, () => wallet.isActiveWalletUnlocked.value], ([approval, unlocked]) => {
  noteActivity()
  if (emptyLockedTimer) {
    clearTimeout(emptyLockedTimer)
    emptyLockedTimer = undefined
  }
  // Queue empty and locked → close after a short grace period. Queue empty
  // and unlocked → stay open in the idle state below.
  if (!approval && !unlocked) {
    emptyLockedTimer = setTimeout(() => {
      if (!currentApproval.value && !isBusy.value) window.close()
    }, EMPTY_LOCKED_CLOSE_GRACE_MS)
  }
})

watch(showUnlockDialog, noteActivity)

onMounted(async () => {
  await initTheme()
  await wallet.ensureLoaded()
  await ZenonService.getInstance().ensureInitialized()
  startInboxBridge()
  isReady.value = true

  idleTimer = setInterval(() => {
    if (!isBusy.value && Date.now() - lastActivityAt >= APPROVAL_WINDOW_IDLE_MS) {
      lockAndClose()
    }
  }, IDLE_CHECK_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (idleTimer) clearInterval(idleTimer)
  if (emptyLockedTimer) clearTimeout(emptyLockedTimer)
})
</script>

<template>
  <TooltipProvider disable-hoverable-content>
    <div class="flex min-h-screen flex-col bg-background p-4">
      <Toaster />

      <template v-if="isReady">
        <!-- Idle state: no pending approval, wallet unlocked — stay open (§6.6). -->
        <div
          v-if="!currentApproval && !showUnlockDialog"
          class="flex flex-1 flex-col items-center justify-center gap-3 text-center"
        >
          <Heading as="h3" :level="4">Connected</Heading>
          <p class="text-sm text-muted-foreground">
            {{ lastOrigin ? `Waiting for requests from ${lastOrigin}` : 'Waiting for requests' }}
          </p>
          <Button variant="outline" :disabled="isBusy" @click="lockAndClose">
            <LockIcon class="h-4 w-4" />
            Lock and close
          </Button>
        </div>

        <DappApprovalDialog :unlock-dialog-open="showUnlockDialog" />

        <UnlockWalletDialog
          v-if="wallet.activeWallet.value"
          v-model:open="showUnlockDialog"
          :wallet-address="wallet.activeWallet.value.baseAddress"
          :wallet-name="wallet.activeWallet.value.name"
          :unlock-error="unlockError"
          @unlock="handleQuickUnlock"
          @cancel="handleCancelUnlock"
        />
      </template>
    </div>
  </TooltipProvider>
</template>

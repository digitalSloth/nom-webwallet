<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDappApprovals, useNetwork, useWallet } from '@/core'
import { watchWalletStorage } from '@/core/composables/useDappApprovals'
import { startInboxBridge } from '@/core/inpage-approval-bridge'
import { whenKeyCacheIdle } from '@/core/key-cache'
import { Button, Heading, Toaster, TooltipProvider, useTheme } from 'nom-ui'
import { LockIcon } from 'lucide-vue-next'
import ApprovalHost from '@/apps/extension/approval/ApprovalHost.vue'
import PopupFrame from '@/apps/extension/components/PopupFrame.vue'
import PowOverlay from '@/apps/small/components/PowOverlay.vue'
import { provideExtensionHost } from '@/apps/extension/small-host'
import { createIdleWatch } from '@/apps/extension/approval/idle-watch'

/**
 * Root of the approval window (approve.html). No router and no header. A
 * transaction request loads the signer's plasma, which opens the node
 * connection. Connect and sign requests never wait on the node.
 */

// The window shares the unlock with the popup through the key cache. The
// grace period keeps the window open briefly on an empty, locked queue so a
// request that follows at once reuses it.
const EMPTY_LOCKED_CLOSE_GRACE_MS = 1200

// The approval window unlocks through its own approval screens and renders no
// small page that asks for an unlock.
provideExtensionHost(() => {})

const wallet = useWallet()
const { currentApproval, isBusy, settleEmptyLocked } = useDappApprovals()
const { initTheme } = useTheme()

const isReady = ref(false)
const lastOrigin = ref<string | null>(null)
// The hash of an approved send whose result screen is showing.
const lastResult = ref<string | null>(null)

watch(currentApproval, (approval) => {
  if (approval) lastOrigin.value = approval.origin
})

// --- Window lifetime (§6.6) ---
let emptyLockedTimer: ReturnType<typeof setTimeout> | undefined
let stopWalletStorage: (() => void) | undefined

const idleWatch = createIdleWatch({
  isBusy: () => isBusy.value,
  onIdle: () => window.close(),
})
const noteActivity = idleWatch.touch

function closeWindow(): void {
  window.close()
}

async function lockAndClose(): Promise<void> {
  wallet.lockAllWallets()
  await whenKeyCacheIdle()
  window.close()
}

watch(
  [currentApproval, () => wallet.isActiveWalletUnlocked.value, lastResult],
  ([approval, unlocked, result]) => {
    noteActivity()
    if (emptyLockedTimer) {
      clearTimeout(emptyLockedTimer)
      emptyLockedTimer = undefined
    }
    // Queue empty and locked → close after a short grace period. Queue empty
    // and unlocked → stay open in the idle state below. After a refused
    // approve the window stays open so the explanation stays readable, and
    // the idle timer or "Lock and close" closes it.
    // A result on screen keeps the window open until Close, Next or the idle
    // close.
    if (!approval && !unlocked && result === null) {
      emptyLockedTimer = setTimeout(() => {
        settleEmptyLocked(() => window.close())
      }, EMPTY_LOCKED_CLOSE_GRACE_MS)
    }
  }
)

onMounted(async () => {
  stopWalletStorage = watchWalletStorage()

  await initTheme()
  await wallet.ensureLoaded()
  // The saved chain and node, for display only. No node connection opens
  // here, so an unreachable node never holds up a connect or sign request.
  await useNetwork().loadConfig()
  startInboxBridge({ kind: 'window' })
  isReady.value = true

  idleWatch.start()
})

onBeforeUnmount(() => {
  idleWatch.stop()
  if (emptyLockedTimer) clearTimeout(emptyLockedTimer)
  stopWalletStorage?.()
})
</script>

<template>
  <TooltipProvider disable-hoverable-content>
    <Toaster class="pointer-events-auto" />
    <PopupFrame>
      <ApprovalHost v-model:result="lastResult" close-label="Close" @close="closeWindow">
        <template #result-actions>
          <Button variant="ghost" class="w-full" :disabled="isBusy" @click="lockAndClose">
            <LockIcon class="h-4 w-4" />
            Lock and close
          </Button>
        </template>
        <template #idle>
          <!-- Idle state: no pending approval, wallet unlocked. Stay open. -->
          <div
            v-if="isReady"
            class="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center"
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
        </template>
      </ApprovalHost>
      <PowOverlay />
    </PopupFrame>
  </TooltipProvider>
</template>

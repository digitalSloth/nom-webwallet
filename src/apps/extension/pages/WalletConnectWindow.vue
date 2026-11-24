<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useWalletConnect } from '@/core'
import { startWalletConnectHostBridge } from '@/core/walletconnect-bridge'
import { Button, Input, useToast } from 'nom-ui'
import ApprovalFrame from '../approval/ApprovalFrame.vue'
import ApprovalHost from '../approval/ApprovalHost.vue'
import PopupFrame from '../components/PopupFrame.vue'
import PowOverlay from '@/apps/small/components/PowOverlay.vue'
import { urlHost } from '@/shared/lib/format'

/**
 * The WalletConnect window: the pairing panel and the approval screens for
 * WalletConnect requests. The window also runs the bridge that publishes its
 * session list to the popup and runs the popup's pair and end commands.
 */

const toast = useToast()
const walletConnect = useWalletConnect()
const { isEnabled, isPairing, sessions, error } = walletConnect

let stopBridge: (() => void) | null = null
onMounted(() => {
  stopBridge = startWalletConnectHostBridge(walletConnect)
})
onBeforeUnmount(() => stopBridge?.())

// The hash of an approved send whose result screen is showing.
const lastResult = ref<string | null>(null)

const uri = ref('')
const paired = ref(false)
const ending = ref<string | null>(null)

async function pair(): Promise<void> {
  const value = uri.value.trim()
  if (!value.startsWith('wc:') || isPairing.value) return
  try {
    await walletConnect.pair(value)
    uri.value = ''
    paired.value = true
  } catch {
    paired.value = false
    toast.show('Failed to pair. Check the link and try again.', 'error')
  }
}

async function end(topic: string): Promise<void> {
  ending.value = topic
  try {
    await walletConnect.disconnect(topic)
  } catch {
    toast.show('Could not end the session.', 'error')
  } finally {
    ending.value = null
  }
}

function sessionIcon(icons: string[] | undefined): string | null {
  const icon = icons?.[0]
  return icon && icon.startsWith('https://') ? icon : null
}
</script>

<template>
  <PopupFrame>
    <ApprovalHost v-model:result="lastResult" close-label="Done">
      <template #idle>
        <ApprovalFrame title="WalletConnect">
          <p v-if="!isEnabled" class="py-6 text-center text-sm text-muted-foreground">
            WalletConnect is not configured for this build.
          </p>

          <template v-else>
            <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

            <form class="space-y-2" @submit.prevent="pair">
              <label for="wc-window-uri" class="block text-ledger text-muted-foreground">
                Pair with a dApp
              </label>
              <div class="flex gap-2">
                <Input
                  id="wc-window-uri"
                  v-model="uri"
                  class="flex-1 font-mono text-xs"
                  placeholder="wc:…"
                  :disabled="isPairing"
                />
                <Button type="submit" :disabled="isPairing || !uri.trim().startsWith('wc:')">
                  Pair
                </Button>
              </div>
              <p v-if="paired" class="text-xs text-muted-foreground">
                Approve the connection when the request appears.
              </p>
            </form>

            <h2 class="text-ledger text-muted-foreground">Active sessions</h2>
            <p v-if="sessions.length === 0" class="py-6 text-center text-sm text-muted-foreground">
              No active sessions.
            </p>
            <ul v-else class="divide-y rounded-lg border">
              <li
                v-for="session in sessions"
                :key="session.topic"
                class="flex items-center gap-2.5 px-3 py-2"
              >
                <img
                  v-if="sessionIcon(session.peer.metadata.icons)"
                  :src="sessionIcon(session.peer.metadata.icons) ?? undefined"
                  alt=""
                  class="size-8 shrink-0 rounded-full bg-muted"
                />
                <span
                  v-else
                  class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
                >
                  {{ (session.peer.metadata.name || 'Unknown dApp').charAt(0).toUpperCase() }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">
                    {{ session.peer.metadata.name || 'Unknown dApp' }}
                  </span>
                  <span class="block truncate font-mono text-xs text-muted-foreground">
                    {{ urlHost(session.peer.metadata.url) }}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :aria-label="`End ${session.peer.metadata.name || 'Unknown dApp'}`"
                  :disabled="ending === session.topic"
                  @click="end(session.topic)"
                >
                  End
                </Button>
              </li>
            </ul>
          </template>

          <template #footer>
            <span class="text-center text-xs text-muted-foreground">
              Keep this window open to receive WalletConnect requests.
            </span>
          </template>
        </ApprovalFrame>
      </template>
    </ApprovalHost>
    <PowOverlay />
  </PopupFrame>
</template>

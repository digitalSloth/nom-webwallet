<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SessionTypes } from '@walletconnect/types'
import { useWalletConnect } from '@/core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  Heading,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
  Spinner,
  useToast,
} from 'nom-ui'
import { ArrowLeftIcon, LinkIcon } from 'lucide-vue-next'

const router = useRouter()
const toast = useToast()
const walletConnect = useWalletConnect()
// In the extension this page opens in its own popup window (App.vue's
// openWalletConnect), not as a route inside the main popup — "back" would
// just navigate that same window to Home, duplicating the wallet UI in two
// places at once. The web app still hosts this as a route, where back to
// Home is meaningful. Bound to a local const: the template compiler can't
// resolve the ambient __IS_EXTENSION__ global directly.
const isExtension = __IS_EXTENSION__

const uri = ref('')
const isConnecting = ref(false)
const disconnectingTopic = ref<string | null>(null)

const canConnect = computed(() => uri.value.trim().startsWith('wc:'))

onMounted(async () => {
  // Only the extension's WalletConnect tab initializes here (§1.8) — the web
  // app does it in App.vue, on mount, so a paste-and-go deep link doesn't
  // have to wait for this page.
  if (__IS_EXTENSION__) {
    try {
      await walletConnect.initialize()
    } catch {
      toast.show('Failed to initialize WalletConnect.', 'error')
    }
  }
})

async function handleConnect() {
  if (!canConnect.value || isConnecting.value) return

  isConnecting.value = true
  try {
    await walletConnect.pair(uri.value.trim())
    uri.value = ''
    toast.show('Connection request sent. Approve it from the dialog.', 'success')
  } catch {
    toast.show('Failed to pair. Check the URI and try again.', 'error')
  } finally {
    isConnecting.value = false
  }
}

async function handleDisconnect(topic: string) {
  disconnectingTopic.value = topic
  try {
    await walletConnect.disconnect(topic)
  } catch {
    toast.show('Failed to disconnect.', 'error')
  } finally {
    disconnectingTopic.value = null
  }
}

function peerName(session: SessionTypes.Struct): string {
  return session.peer.metadata.name || 'Unknown dApp'
}

function peerIcon(session: SessionTypes.Struct): string | null {
  const icon = session.peer.metadata.icons[0]
  return icon && icon.startsWith('https://') ? icon : null
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button v-if="!isExtension" @click="goBack" variant="outline" title="Go back">
          <ArrowLeftIcon />
        </Button>
        <Heading as="h1">WalletConnect</Heading>
      </div>
    </div>

    <div class="container mx-auto max-w-4xl space-y-6 p-6">
      <Alert v-if="!walletConnect.isEnabled">
        <AlertDescription>
          WalletConnect is not configured for this build. Set
          <code>VITE_WALLETCONNECT_PROJECT_ID</code> and rebuild to enable it.
        </AlertDescription>
      </Alert>

      <template v-else>
        <Card>
          <CardHeader>
            <Heading as="h3" :level="4">Connect to a dApp</Heading>
          </CardHeader>
          <CardContent class="space-y-3">
            <Alert v-if="walletConnect.error.value" variant="destructive">
              <AlertDescription>{{ walletConnect.error.value }}</AlertDescription>
            </Alert>
            <div class="relative">
              <LinkIcon
                class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input v-model="uri" placeholder="wc:..." class="pl-9" />
            </div>
            <Button class="w-full" :disabled="!canConnect || isConnecting" @click="handleConnect">
              <span v-if="isConnecting" class="flex items-center gap-2">
                <Spinner class="size-4" />Connecting...
              </span>
              <span v-else>Connect</span>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <Heading as="h3" :level="4">
              Sessions ({{ walletConnect.sessions.value.length }})
            </Heading>
          </CardHeader>
          <CardContent>
            <div
              v-if="walletConnect.sessions.value.length === 0"
              class="py-8 text-center text-muted-foreground"
            >
              <p>No active sessions</p>
            </div>

            <div v-else class="space-y-3">
              <Item
                v-for="session in walletConnect.sessions.value"
                :key="session.topic"
                variant="muted"
              >
                <ItemMedia v-if="peerIcon(session)" variant="image">
                  <img :src="peerIcon(session)!" alt="" />
                </ItemMedia>
                <ItemContent class="min-w-0 flex-1">
                  <ItemTitle>{{ peerName(session) }}</ItemTitle>
                  <ItemDescription>{{ session.peer.metadata.url }}</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    variant="outline"
                    size="sm"
                    :disabled="disconnectingTopic === session.topic"
                    @click="handleDisconnect(session.topic)"
                  >
                    Disconnect
                  </Button>
                </ItemActions>
              </Item>
            </div>
          </CardContent>
        </Card>
      </template>
    </div>
  </div>
</template>

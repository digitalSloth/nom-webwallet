<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { WALLETCONNECT_ENABLED } from '@/config'
import { useConnectedSites } from '@/core/composables/useConnectedSites'
import { useWalletConnectSessions } from '@/core/composables/useWalletConnectSessions'
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from 'nom-ui'
import PageHeader from '../components/PageHeader.vue'
import { relativeTime, shortAddress, urlHost } from '@/shared/lib/format'

const router = useRouter()
const toast = useToast()
const connectedSites = useConnectedSites()
const walletConnect = useWalletConnectSessions()

const activeTab = ref<'sites' | 'walletconnect'>('sites')
const busy = ref(false)
const uri = ref('')
const paired = ref(false)

const sortedSites = computed(() =>
  [...connectedSites.sites.value].sort((a, b) => b.lastUsedAt - a.lastUsedAt)
)

const sitesLabel = computed(() => `Browser sites · ${connectedSites.sites.value.length}`)
const walletConnectLabel = computed(() =>
  WALLETCONNECT_ENABLED ? `WalletConnect · ${walletConnect.sessions.value.length}` : 'WalletConnect'
)

onMounted(() => {
  void connectedSites.refresh()
  void walletConnect.refresh()
  void walletConnect.checkPairResult()
})

// The error shows once per result.
onBeforeUnmount(() => walletConnect.clearPairError())

// A failure shows on the tab that holds the pair form.
watch(
  walletConnect.pairFailed,
  (failed) => {
    if (failed) activeTab.value = 'walletconnect'
  },
  { immediate: true }
)

const verifyLabels = {
  valid: { text: 'Verified', class: 'text-success' },
  unknown: { text: 'Unverified', class: 'text-warning' },
  invalid: { text: 'Unverified', class: 'text-destructive' },
} as const

function hostInitial(origin: string): string {
  return urlHost(origin).charAt(0).toUpperCase()
}

function connectedOn(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

async function run(action: () => Promise<void>, failure: string): Promise<boolean> {
  if (busy.value) return false
  busy.value = true
  try {
    await action()
    return true
  } catch {
    toast.show(failure, 'error')
    return false
  } finally {
    busy.value = false
  }
}

const revokeFailure = 'Could not disconnect. Try again.'
const windowFailure = 'Could not open the WalletConnect window.'

function revoke(origin: string): Promise<boolean> {
  return run(() => connectedSites.revokeOrigin(origin), revokeFailure)
}

function stopMessages(origin: string): Promise<boolean> {
  return run(
    () => connectedSites.revokeMessages(origin),
    'Could not stop message access. Try again.'
  )
}

function revokeAll(): Promise<boolean> {
  return run(() => connectedSites.revokeAllSites(), revokeFailure)
}

async function pair(): Promise<void> {
  paired.value = false
  if (await run(() => walletConnect.pair(uri.value), windowFailure)) {
    uri.value = ''
    paired.value = true
  }
}

function openWindow(): Promise<boolean> {
  return run(() => walletConnect.open(), windowFailure)
}

function end(topic: string): Promise<boolean> {
  return run(() => walletConnect.end(topic), windowFailure)
}

function endAll(): Promise<boolean> {
  return run(() => walletConnect.endAll(), windowFailure)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Connected sites" @back="router.push({ name: 'settings' })" />

    <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col px-4 pt-2">
      <TabsList variant="underline">
        <TabsTrigger variant="underline" value="sites">{{ sitesLabel }}</TabsTrigger>
        <TabsTrigger variant="underline" value="walletconnect">{{
          walletConnectLabel
        }}</TabsTrigger>
      </TabsList>

      <div class="flex-1 space-y-3 overflow-y-auto py-3">
        <TabsContent value="sites" class="space-y-3">
          <p v-if="sortedSites.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            No connected sites.
          </p>
          <ul v-else class="divide-y rounded-lg border">
            <li v-for="site in sortedSites" :key="site.origin" class="px-3 py-2">
              <div class="flex items-center gap-2.5">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-sm font-semibold text-muted-foreground"
                >
                  {{ hostInitial(site.origin) }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-mono text-xs">{{ site.origin }}</span>
                  <span class="block text-xs text-muted-foreground">
                    Connected {{ connectedOn(site.connectedAt) }} · used
                    {{ relativeTime(site.lastUsedAt) }}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :aria-label="`Disconnect ${site.origin}`"
                  :disabled="busy"
                  @click="revoke(site.origin)"
                >
                  Disconnect
                </Button>
              </div>
              <div
                v-if="site.messageAccounts?.length"
                class="mt-2 flex items-center gap-2.5 rounded-md bg-muted px-2.5 py-1.5"
              >
                <span class="min-w-0 flex-1 text-xs">
                  Reads encrypted messages and inscriptions
                  <span class="block truncate font-mono text-muted-foreground">
                    {{ site.messageAccounts.map(shortAddress).join(', ') }}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :aria-label="`Stop ${site.origin} reading encrypted messages and inscriptions`"
                  :disabled="busy"
                  @click="stopMessages(site.origin)"
                >
                  Stop
                </Button>
              </div>
            </li>
          </ul>
          <p class="text-xs text-muted-foreground">
            Connected sites can read your address, chain ID and node URL. Every transaction and
            signature still asks you first. Sites you allow can also read your encrypted messages
            and inscriptions.
          </p>
        </TabsContent>

        <TabsContent value="walletconnect" class="space-y-3">
          <p v-if="!WALLETCONNECT_ENABLED" class="py-6 text-center text-sm text-muted-foreground">
            WalletConnect is not configured for this build.
          </p>

          <template v-else>
            <form class="space-y-2" @submit.prevent="pair">
              <label for="wc-uri" class="block text-ledger text-muted-foreground">
                Pair with a dApp
              </label>
              <div class="flex gap-2">
                <Input
                  id="wc-uri"
                  v-model="uri"
                  class="flex-1 font-mono text-xs"
                  placeholder="wc:…"
                  :disabled="busy"
                />
                <Button type="submit" :disabled="busy || !uri.trim().startsWith('wc:')"
                  >Pair</Button
                >
              </div>
              <p
                v-if="walletConnect.pairFailed.value"
                role="alert"
                class="text-xs text-destructive"
              >
                Failed to pair. Check the link and try again — links expire after a few minutes.
              </p>
              <p class="text-xs text-muted-foreground">
                {{
                  paired && !walletConnect.pairFailed.value
                    ? 'Continue in the WalletConnect window.'
                    : 'Copy the WalletConnect link from the dApp and paste it here.'
                }}
              </p>
            </form>

            <h2 class="text-ledger text-muted-foreground">Active sessions</h2>
            <p
              v-if="walletConnect.sessions.value.length === 0"
              class="py-6 text-center text-sm text-muted-foreground"
            >
              No active sessions.
            </p>
            <ul v-else class="divide-y rounded-lg border">
              <li
                v-for="session in walletConnect.sessions.value"
                :key="session.topic"
                class="flex items-center gap-2.5 px-3 py-2"
              >
                <img
                  v-if="session.icon"
                  :src="session.icon"
                  alt=""
                  class="size-8 shrink-0 rounded-full bg-muted"
                />
                <span
                  v-else
                  class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
                >
                  {{ session.name.charAt(0).toUpperCase() }}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold">{{ session.name }}</span>
                  <span class="block truncate font-mono text-xs text-muted-foreground">
                    {{ urlHost(session.url) }}
                    <template v-if="session.verification">
                      ·
                      <span :class="verifyLabels[session.verification].class">{{
                        verifyLabels[session.verification].text
                      }}</span>
                    </template>
                    <template v-if="session.approvedAt">
                      · connected {{ connectedOn(session.approvedAt) }}
                    </template>
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :aria-label="`End ${session.name}`"
                  :disabled="busy"
                  @click="end(session.topic)"
                >
                  End
                </Button>
              </li>
            </ul>
            <Button variant="ghost" class="w-full" :disabled="busy" @click="openWindow">
              Open WalletConnect window
            </Button>
          </template>
        </TabsContent>
      </div>
    </Tabs>

    <footer v-if="activeTab === 'sites'" class="border-t px-4 py-3">
      <Button
        variant="ghost"
        class="w-full text-destructive"
        :disabled="busy || sortedSites.length === 0"
        @click="revokeAll"
      >
        Disconnect all sites
      </Button>
    </footer>
    <footer v-else-if="WALLETCONNECT_ENABLED" class="border-t px-4 py-3">
      <Button
        variant="ghost"
        class="w-full text-destructive"
        :disabled="busy || walletConnect.sessions.value.length === 0"
        @click="endAll"
      >
        End all sessions
      </Button>
    </footer>
  </div>
</template>

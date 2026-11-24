<script setup lang="ts">
import { computed, ref } from 'vue'
import { Alert, AlertDescription, Button, Input, useToast } from 'nom-ui'
import { useWallet, useWalletConnect } from '@/core'
import { sessionDetail, sessionRows } from '../lib/connected-apps'

defineProps<{ embedded?: boolean }>()

const toast = useToast()
const wallet = useWallet()
const walletConnect = useWalletConnect()

const uri = ref('')
const pairError = ref<string | null>(null)
const busy = ref(false)

const rows = computed(() =>
  sessionRows(walletConnect.sessions.value, walletConnect.sessionMeta.value, wallet.wallets.value)
)
const canPair = computed(() => uri.value.trim().startsWith('wc:') && !walletConnect.isPairing.value)

const TONES = {
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const
const DOTS = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
} as const

async function pair(): Promise<void> {
  if (!canPair.value) return
  pairError.value = null
  try {
    // A failed start-up initialisation is retried here.
    await walletConnect.initialize()
    await walletConnect.pair(uri.value.trim())
    uri.value = ''
  } catch {
    pairError.value =
      'Failed to pair. Check the link and try again — links expire after a few minutes.'
  }
}

async function run(action: () => Promise<void>, failure: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } catch {
    toast.show(failure, 'error')
  } finally {
    busy.value = false
  }
}

const end = (topic: string) =>
  run(() => walletConnect.disconnect(topic), 'Could not end the session. Try again.')
const endAll = () =>
  run(() => walletConnect.disconnectAll(), 'Could not end every session. Try again.')
</script>

<template>
  <div class="mx-auto flex max-w-[1040px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 v-if="!embedded" class="text-3xl font-semibold tracking-tight">Connected apps</h1>
      <p class="text-sm text-muted-foreground">
        Connect Zenon dApps with WalletConnect. Apps can read your address; every transaction and
        signature asks you first.
      </p>
    </div>

    <Alert v-if="!walletConnect.isEnabled">
      <AlertDescription>
        WalletConnect is not configured for this build. Set
        <code>VITE_WALLETCONNECT_PROJECT_ID</code> and rebuild to enable it.
      </AlertDescription>
    </Alert>

    <template v-else>
      <form
        class="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-5 shadow-sm"
        @submit.prevent="pair"
      >
        <span class="flex flex-[1_1_360px] flex-col gap-1.5">
          <label for="wc-pair" class="text-ledger text-muted-foreground">Pair with a dApp</label>
          <Input
            id="wc-pair"
            v-model="uri"
            class="font-mono"
            placeholder="wc:…"
            autocomplete="off"
            spellcheck="false"
          />
        </span>
        <Button type="submit" :disabled="!canPair">Pair</Button>
        <span class="basis-full text-xs text-muted-foreground">
          Copy the WalletConnect link from the dApp and paste it here.
        </span>
        <p v-if="pairError" role="alert" class="basis-full text-sm text-destructive">
          {{ pairError }}
        </p>
      </form>

      <section aria-labelledby="ca-h" class="rounded-xl border bg-card">
        <div class="flex items-center gap-3 border-b px-5 py-4">
          <h2 id="ca-h" class="grow text-base font-semibold">Active sessions</h2>
          <Button
            v-if="rows.length > 0"
            variant="ghost"
            size="sm"
            class="text-destructive"
            :disabled="busy"
            @click="endAll"
          >
            End all
          </Button>
        </div>
        <p v-if="rows.length === 0" class="px-5 py-6 text-center text-sm text-muted-foreground">
          {{ walletConnect.isInitialized.value ? 'No active sessions.' : 'Loading sessions…' }}
        </p>
        <ul v-else class="divide-y">
          <li
            v-for="row in rows"
            :key="row.topic"
            class="flex flex-wrap items-center gap-3 px-5 py-3.5"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted font-semibold text-muted-foreground"
              aria-hidden="true"
            >
              {{ row.initial }}
            </span>
            <span class="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
              <span class="truncate text-sm font-semibold">{{ row.name }}</span>
              <span class="truncate text-xs text-muted-foreground">
                {{ sessionDetail(row) }}
              </span>
            </span>
            <span
              v-if="row.verification"
              :class="['flex items-center gap-1.5 text-xs', TONES[row.verification.tone]]"
            >
              <span
                :class="['size-2 rounded-full', DOTS[row.verification.tone]]"
                aria-hidden="true"
              />
              {{ row.verification.text }}
            </span>
            <Button
              variant="outline"
              size="sm"
              :aria-label="`End session with ${row.name}`"
              :disabled="busy"
              @click="end(row.topic)"
            >
              End session
            </Button>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

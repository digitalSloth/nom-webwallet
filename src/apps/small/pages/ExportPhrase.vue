<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useWallet } from '@/core'
import { Alert, AlertDescription, Button, CopyButton, Input } from 'nom-ui'
import { TriangleAlertIcon } from 'lucide-vue-next'
import { canManage, WALLET_LOCKED_MESSAGE } from '@/shared/lib/manage-wallet'
import PageHeader from '../components/PageHeader.vue'

const HIDE_AFTER_MS = 60_000

const route = useRoute()
const router = useRouter()
const wallet = useWallet()

const address = route.params.address as string
const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === address) ?? null)

// Only this ref holds the phrase: no module state, storage or log.
const phrase = ref<string | null>(null)
const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | undefined
// Bumped by hide() so a reveal still decrypting cannot show the phrase afterwards
let revealGen = 0

const words = computed(() => (phrase.value ? phrase.value.split(/\s+/) : []))

function hide(): void {
  revealGen++
  phrase.value = null
  password.value = ''
  if (hideTimer !== undefined) clearTimeout(hideTimer)
  hideTimer = undefined
}

async function reveal(): Promise<void> {
  if (busy.value || password.value === '') return
  if (!canManage(wallet, address)) {
    error.value = WALLET_LOCKED_MESSAGE
    return
  }
  busy.value = true
  error.value = null
  try {
    const pw = password.value
    password.value = ''
    const gen = revealGen
    const revealed = await wallet.exportMnemonicWithPassword(address, pw)
    if (gen !== revealGen || document.visibilityState === 'hidden') return
    phrase.value = revealed
    hideTimer = setTimeout(hide, HIDE_AFTER_MS)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not show the recovery phrase'
  } finally {
    busy.value = false
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') hide()
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  hide()
})
onBeforeRouteLeave(() => {
  hide()
})

function done(): void {
  void router.push({ name: 'manage-wallet', params: { address } })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Recovery phrase" :back-disabled="busy" @back="done">
      <span class="truncate text-xs text-muted-foreground">{{ target?.name }}</span>
    </PageHeader>

    <div v-if="target" class="flex-1 space-y-4 overflow-y-auto p-4">
      <template v-if="phrase === null">
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertDescription>
            <p class="font-medium">Anyone with this phrase controls this wallet's funds.</p>
            <p>
              NoM Wallet never asks for it. Don't share it, paste it into a site, or store it in a
              screenshot.
            </p>
          </AlertDescription>
        </Alert>

        <form class="space-y-2" @submit.prevent="reveal">
          <label for="export-password" class="text-sm font-medium">
            Enter your password to continue
          </label>
          <Input
            id="export-password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
          />
          <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
          <Button type="submit" class="w-full" :disabled="password === '' || busy">
            {{ busy ? 'Checking…' : 'Show recovery phrase' }}
          </Button>
        </form>
      </template>

      <template v-else>
        <ol class="grid grid-cols-3 gap-2">
          <li
            v-for="(word, i) in words"
            :key="i"
            class="rounded-md border bg-card px-2 py-1.5 font-mono text-sm"
          >
            <span class="text-muted-foreground">{{ String(i + 1).padStart(2, '0') }}</span>
            {{ word }}
          </li>
        </ol>
        <p class="text-xs text-muted-foreground">
          This screen hides the phrase again when you leave or after 60 seconds.
        </p>
      </template>
    </div>

    <footer v-if="phrase !== null" class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <CopyButton :value="phrase" variant="outline" size="default" class="w-full" />
      <Button @click="done">Done</Button>
    </footer>
  </div>
</template>

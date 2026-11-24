<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Input, Popover, PopoverContent, PopoverTrigger, useToast, ZnnLogo } from 'nom-ui'
import { ChevronDownIcon, ExternalLinkIcon, EyeIcon, EyeOffIcon } from 'lucide-vue-next'
import { useAutoLock, useUnlockTarget, useWallet } from '@/core'
import { surface } from '../surface'
import { shortAddress } from '@/shared/lib/format'
import { lockedRedirect, managesOtherWallet } from '@/apps/small/routes'
import HomeSkeleton from '@/apps/small/components/HomeSkeleton.vue'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const toast = useToast()
const { minutes } = useAutoLock()

const password = ref('')
const showPassword = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)
const pickerOpen = ref(false)
// Bumped when the pinned wallet changes, so a late result for the old wallet is dropped.
let gen = 0

const { unlockTarget, pinActiveWallet } = useUnlockTarget(() => {
  password.value = ''
  error.value = null
  showPassword.value = false
  gen++
  pinActiveWallet()
})
pinActiveWallet()

const targetWallet = computed(
  () => wallet.wallets.value.find((w) => w.baseAddress === unlockTarget.value?.baseAddress) ?? null
)

// A manage page for another wallet asks for that wallet to be unlocked: make
// it the active wallet first, and stay put until that has happened. The
// request is applied once and then dropped from the query, so a later pick in
// the chooser, or a remount, never switches back.
const switching = ref(false)
const requested = typeof route.query.wallet === 'string' ? route.query.wallet : null
if (
  requested &&
  requested !== wallet.activeWallet.value?.baseAddress &&
  wallet.wallets.value.some((w) => w.baseAddress === requested)
) {
  switching.value = true
  wallet
    .setActiveWallet(requested)
    .then(() => router.replace({ name: 'locked', query: { redirect: route.query.redirect } }))
    .catch(async (err) => {
      toast.show(err instanceof Error ? err.message : 'Could not switch wallet', 'error')
      await router.replace({ name: 'locked', query: { redirect: '/' } })
    })
    .finally(() => {
      switching.value = false
    })
}

function openInTab(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?surface=tab') })
}

async function pickWallet(address: string): Promise<void> {
  pickerOpen.value = false
  if (address === wallet.activeWallet.value?.baseAddress) return
  try {
    // A redirect to another wallet's manage page, or a pending request for
    // one, must not outlive the pick. Replace it before the wallet changes,
    // because the change remounts this screen.
    const redirect = lockedRedirect(route.query.redirect)
    const manages = managesOtherWallet(redirect, address)
    if (route.query.wallet !== undefined || manages) {
      await router.replace({
        name: 'locked',
        query: { redirect: manages ? '/settings/wallets' : redirect },
      })
    }
    await wallet.setActiveWallet(address)
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Could not switch wallet', 'error')
  }
}

async function submit(): Promise<void> {
  if (busy.value || password.value === '' || !unlockTarget.value) return
  const target = unlockTarget.value.baseAddress
  const pw = password.value
  const startedAt = gen
  password.value = ''
  error.value = null
  busy.value = true
  try {
    await wallet.unlockWallet(target, pw)
  } catch (err) {
    if (startedAt !== gen) return
    const message = err instanceof Error ? err.message : ''
    error.value = message === 'Invalid password' ? 'Incorrect password. Try again.' : message
  } finally {
    busy.value = false
  }
}

// Covers an unlock here, an unlock in another window, picking an unlocked
// wallet in the chooser, and opening this screen while unlocked.
watch(
  () => wallet.isActiveWalletUnlocked.value && !switching.value,
  (leave) => {
    if (leave) void router.replace(lockedRedirect(route.query.redirect))
  },
  { immediate: true }
)
</script>

<template>
  <div class="relative h-full overflow-hidden">
    <HomeSkeleton
      aria-hidden="true"
      inert
      class="pointer-events-none opacity-45 blur-[14px] select-none"
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Unlock wallet"
      class="absolute inset-0 flex flex-col bg-background/60"
    >
      <div class="flex h-12 items-center justify-end px-3">
        <Button
          v-if="surface === 'popup'"
          variant="ghost"
          size="icon"
          class="text-muted-foreground"
          aria-label="Open full wallet in a tab"
          @click="openInTab"
        >
          <ExternalLinkIcon class="size-4" />
        </Button>
      </div>

      <div class="flex flex-col items-center gap-3 px-6 pt-6 pb-6">
        <ZnnLogo class="h-14 w-auto" />
        <h1 class="text-xl font-semibold">Welcome back</h1>

        <Popover v-model:open="pickerOpen">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="flex max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-3 pl-1 text-sm"
              aria-label="Choose a wallet"
            >
              <template v-if="targetWallet">
                <span
                  class="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold"
                >
                  {{ targetWallet.name.charAt(0).toUpperCase() }}
                </span>
                <span class="truncate font-medium">{{ targetWallet.name }}</span>
                <span class="font-mono text-xs text-muted-foreground">
                  {{ shortAddress(targetWallet.baseAddress) }}
                </span>
              </template>
              <span v-else class="px-2 text-muted-foreground">Choose a wallet</span>
              <ChevronDownIcon class="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="max-h-64 w-64 overflow-y-auto p-1">
            <button
              v-for="w in wallet.wallets.value"
              :key="w.baseAddress"
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
              @click="pickWallet(w.baseAddress)"
            >
              <span
                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold"
              >
                {{ w.name.charAt(0).toUpperCase() }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ w.name }}</span>
                <span class="block font-mono text-xs text-muted-foreground">
                  {{ shortAddress(w.baseAddress) }}
                </span>
              </span>
            </button>
          </PopoverContent>
        </Popover>
      </div>

      <form class="space-y-2 px-6" @submit.prevent="submit">
        <label for="unlock-password" class="text-ledger">Password</label>
        <div class="relative">
          <Input
            id="unlock-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="pr-10"
            :class="{ 'border-destructive': error }"
            :aria-invalid="error !== null"
            autocomplete="current-password"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            autofocus
          />
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            @click="showPassword = !showPassword"
          >
            <EyeOffIcon v-if="showPassword" class="size-4" />
            <EyeIcon v-else class="size-4" />
          </button>
        </div>
        <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
        <Button
          type="submit"
          size="lg"
          class="w-full"
          :disabled="busy || password === '' || !unlockTarget"
        >
          {{ busy ? 'Unlocking…' : 'Unlock' }}
        </Button>
      </form>

      <div class="flex-1" />
      <footer class="flex flex-col items-center gap-1 px-6 py-5 text-center text-xs">
        <span class="text-muted-foreground">Forgot your password?</span>
        <a
          href="#"
          class="text-info hover:underline"
          @click.prevent="router.push({ name: 'import-phrase' })"
        >
          Restore with your recovery phrase
        </a>
        <span class="text-muted-foreground">
          Auto-locks after {{ minutes }} minutes of inactivity
        </span>
      </footer>
    </div>
  </div>
</template>

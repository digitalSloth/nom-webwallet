<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Input, Popover, PopoverContent, PopoverTrigger, ZnnLogo } from 'nom-ui'
import { ChevronDownIcon, EyeIcon, EyeOffIcon } from 'lucide-vue-next'
import { useAutoLock, useUnlockTarget, useWallet } from '@/core'
import { usePhoneLayout } from '../breakpoint'

const router = useRouter()
const phone = usePhoneLayout()
const wallet = useWallet()
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
const canChoose = computed(() => wallet.wallets.value.length > 1 || targetWallet.value === null)

async function pickWallet(address: string): Promise<void> {
  pickerOpen.value = false
  if (address === wallet.activeWallet.value?.baseAddress) return
  try {
    await wallet.setActiveWallet(address)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not switch wallet'
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
</script>

<template>
  <div
    role="dialog"
    aria-modal="true"
    aria-label="Unlock wallet"
    class="fixed inset-0 z-40 overflow-y-auto bg-background/60"
    style="
      background-image: radial-gradient(
        circle at 50% 22%,
        hsl(145 100% 42% / 0.14),
        transparent 45%
      );
    "
  >
    <div
      class="mx-auto flex max-w-[400px] flex-col gap-6 px-4"
      :class="phone ? 'min-h-full justify-center py-6' : 'pt-[140px] pb-12'"
    >
      <div class="flex flex-col items-center gap-3 text-center">
        <ZnnLogo class="size-14" />
        <h1 class="mt-2 text-[26px] font-semibold">Welcome back</h1>

        <Popover v-if="canChoose" v-model:open="pickerOpen">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="flex max-w-full items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-[13px]"
              aria-label="Choose a wallet"
            >
              <span v-if="targetWallet" class="truncate font-semibold">{{
                targetWallet.name
              }}</span>
              <span v-else class="text-muted-foreground">Choose a wallet</span>
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
              <span class="block min-w-0 flex-1 truncate text-sm font-medium">{{ w.name }}</span>
            </button>
          </PopoverContent>
        </Popover>
        <div
          v-else
          class="flex max-w-full items-center rounded-full border bg-card px-3 py-1.5 text-[13px]"
        >
          <span class="truncate font-semibold">{{ targetWallet?.name }}</span>
        </div>
      </div>

      <form
        class="flex flex-col gap-2 rounded-xl border bg-card p-6 shadow"
        @submit.prevent="submit"
      >
        <label for="unlock-password" class="text-ledger text-muted-foreground">Password</label>
        <div class="relative">
          <Input
            id="unlock-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="h-11 pr-10"
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
        <p v-if="error" role="alert" class="text-[13px] text-destructive">{{ error }}</p>
        <Button
          type="submit"
          size="lg"
          class="mt-2 w-full"
          :disabled="busy || password === '' || !unlockTarget"
        >
          {{ busy ? 'Unlocking…' : 'Unlock' }}
        </Button>
      </form>

      <p class="text-center text-[13px] leading-relaxed text-muted-foreground">
        Forgot your password?
        <a
          href="#"
          class="font-medium text-info no-underline"
          @click.prevent="router.push({ name: 'import-phrase' })"
        >
          Restore with your recovery phrase
        </a>
        <br />
        Auto-locks after {{ minutes }} minutes of inactivity.
      </p>
    </div>
  </div>
</template>

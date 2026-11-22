<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button, Input, useToast } from 'nom-ui'
import { CheckIcon, EyeIcon, EyeOffIcon } from 'lucide-vue-next'
import { estimatePasswordStrength, usePasswordStrength, useWallet } from '@/core'
import { EMPTY_PASSWORD_STRENGTH } from '@/core/password-strength'
import PasswordStrengthMeter from '@/shared/components/PasswordStrengthMeter.vue'
import SetupHeader from '../components/SetupHeader.vue'
import { clearSetupDraft, getSetupDraft, setCreatePassword } from '@/shared/lib/create-draft'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const toast = useToast()

const isImport = route.name === 'import-password'

// Read once: the draft is gone after a successful save, and a page remounted
// by then renders nothing.
const draft = getSetupDraft()
const importDraft = draft?.kind === 'import' ? draft : null
const createDraft = draft?.kind === 'create' ? draft : null
const ready = isImport ? importDraft !== null : true

const name = ref(createDraft && !isImport ? createDraft.name : '')
const password = ref(createDraft && !isImport ? createDraft.password : '')
const confirm = ref(createDraft && !isImport ? createDraft.password : '')
const showPassword = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

const strength = usePasswordStrength(password)
// strength is a deep ref, so its value is a reactive proxy; toRaw recovers the
// reset object set on every keystroke. Skipping it keeps a strong password
// from flashing the alert while its score loads.
const weak = computed(
  () =>
    password.value !== '' &&
    toRaw(strength.value) !== EMPTY_PASSWORD_STRENGTH &&
    !strength.value.meetsFloor
)
const matches = computed(() => password.value === confirm.value)
const canSubmit = computed(
  () => !busy.value && password.value !== '' && strength.value.meetsFloor && matches.value
)

const existing = computed(() =>
  importDraft
    ? (wallet.wallets.value.find((w) => w.baseAddress === importDraft.baseAddress) ?? null)
    : null
)

function back(): void {
  // Step 2 of import is only reachable from step 1, so the previous entry is step 1.
  if (isImport) router.back()
  else void router.push({ name: 'welcome' })
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  busy.value = true
  error.value = null
  // Snapshot the values:
  const pw = password.value
  const walletName = name.value.trim()
  try {
    if (!isImport) {
      if (!(await estimatePasswordStrength(pw)).meetsFloor) {
        error.value = 'Please choose a stronger password'
        return
      }
      setCreatePassword(walletName, pw)
      await router.push({ name: 'create-phrase' })
      return
    }

    if (!importDraft) return
    const restoring = existing.value !== null
    await wallet.restoreWallet(importDraft.phrase, pw, walletName || undefined)
    clearSetupDraft()
    toast.show(restoring ? 'Wallet restored' : 'Wallet imported', 'success')
    await router.replace('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not import the wallet'
    password.value = ''
    confirm.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="ready" class="flex h-full flex-col">
    <SetupHeader
      :label="isImport ? 'Import wallet · Step 2 of 2' : 'Create wallet · Step 1 of 3'"
      :step="isImport ? 2 : 1"
      :steps="isImport ? 2 : 3"
      :back-disabled="busy"
      @back="back"
    />

    <form
      class="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5"
      @submit.prevent="submit"
    >
      <div class="space-y-1">
        <h1 class="text-xl font-semibold">Set a password</h1>
        <p class="text-sm text-muted-foreground">
          It encrypts your wallet on this device. It can't recover your wallet — only your recovery
          phrase can.
        </p>
      </div>

      <p v-if="existing" class="rounded-md border bg-card p-3 text-sm">
        This phrase restores {{ existing.name }}. Its accounts stay, and this password replaces the
        old one.
      </p>
      <div v-else class="space-y-1.5">
        <label for="setup-name" class="text-ledger">Wallet name (optional)</label>
        <Input
          id="setup-name"
          v-model="name"
          :placeholder="isImport ? 'Imported wallet' : 'Main wallet'"
          autocomplete="off"
          :disabled="busy"
        />
      </div>

      <div class="space-y-1.5">
        <label for="setup-password" class="text-ledger">Password</label>
        <div class="relative">
          <Input
            id="setup-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            class="pr-10"
            autocomplete="new-password"
            spellcheck="false"
            autocapitalize="off"
            autocorrect="off"
            :disabled="busy"
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
        <PasswordStrengthMeter v-if="password !== ''" :strength="strength" />
        <p v-if="weak" role="alert" class="text-xs text-destructive">
          Please choose a stronger password. Use at least 12 characters; a few unrelated words works
          well.
        </p>
      </div>

      <div class="space-y-1.5">
        <label for="setup-confirm" class="text-ledger">Confirm password</label>
        <Input
          id="setup-confirm"
          v-model="confirm"
          :type="showPassword ? 'text' : 'password'"
          autocomplete="new-password"
          spellcheck="false"
          autocapitalize="off"
          autocorrect="off"
          :disabled="busy"
        />
        <p
          v-if="confirm !== ''"
          class="flex items-center gap-1 text-xs"
          :class="matches ? 'text-success' : 'text-destructive'"
        >
          <CheckIcon v-if="matches" class="size-3.5" />
          {{ matches ? 'Passwords match' : 'Passwords do not match' }}
        </p>
      </div>

      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

      <div class="flex-1" />
      <Button type="submit" size="lg" class="w-full" :disabled="!canSubmit">
        <template v-if="isImport">{{ busy ? 'Importing…' : 'Import wallet' }}</template>
        <template v-else>Continue</template>
      </Button>
    </form>
  </div>
</template>

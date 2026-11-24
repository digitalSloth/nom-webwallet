<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePasswordStrength, useWallet } from '@/core'
import { Button, Input, useToast } from 'nom-ui'
import { canManage, WALLET_LOCKED_MESSAGE } from '@/shared/lib/manage-wallet'
import PageHeader from '../components/PageHeader.vue'
import PasswordStrengthMeter from '@/shared/components/PasswordStrengthMeter.vue'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const toast = useToast()

const address = route.params.address as string
const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === address) ?? null)

const current = ref('')
const next = ref('')
const confirm = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

const strength = usePasswordStrength(next)
const matches = computed(() => next.value === confirm.value)

const canSubmit = computed(
  () =>
    !busy.value &&
    current.value !== '' &&
    next.value !== '' &&
    confirm.value !== '' &&
    strength.value.meetsFloor &&
    matches.value
)

async function submit(): Promise<void> {
  if (busy.value || !canSubmit.value) return
  if (!canManage(wallet, address)) {
    error.value = WALLET_LOCKED_MESSAGE
    return
  }
  busy.value = true
  error.value = null
  try {
    // Snapshot the values before the slow re-encrypt.
    const currentPw = current.value
    const nextPw = next.value
    await wallet.changePassword(address, currentPw, nextPw)
    toast.show('Password changed', 'success')
    await router.replace({ name: 'manage-wallet', params: { address } })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not change the password'
    current.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader
      title="Change password"
      :back-disabled="busy"
      @back="router.push({ name: 'manage-wallet', params: { address } })"
    >
      <span class="truncate text-xs text-muted-foreground">{{ target?.name }}</span>
    </PageHeader>

    <form v-if="target" class="flex flex-1 flex-col" @submit.prevent="submit">
      <div class="flex-1 space-y-4 overflow-y-auto p-4">
        <div class="space-y-2">
          <label for="current-password" class="text-sm font-medium">Current password</label>
          <Input
            id="current-password"
            v-model="current"
            type="password"
            autocomplete="current-password"
            :disabled="busy"
          />
        </div>

        <div class="space-y-2">
          <label for="new-password" class="text-sm font-medium">New password</label>
          <Input
            id="new-password"
            v-model="next"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
          />
          <PasswordStrengthMeter v-if="next !== ''" :strength="strength" />
        </div>

        <div class="space-y-2">
          <label for="confirm-password" class="text-sm font-medium">Confirm new password</label>
          <Input
            id="confirm-password"
            v-model="confirm"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
          />
          <p
            v-if="confirm !== ''"
            class="text-xs"
            :class="matches ? 'text-success' : 'text-destructive'"
          >
            {{ matches ? 'Passwords match' : 'Passwords do not match' }}
          </p>
        </div>

        <p class="text-xs text-muted-foreground">
          Re-encrypts this wallet on this device. Your recovery phrase and addresses don't change.
        </p>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <footer class="border-t px-4 py-3">
        <Button type="submit" class="w-full" :disabled="!canSubmit">
          {{ busy ? 'Re-encrypting…' : 'Change password' }}
        </Button>
      </footer>
    </form>
  </div>
</template>

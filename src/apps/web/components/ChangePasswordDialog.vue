<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from 'nom-ui'
import { usePasswordStrength, useWallet } from '@/core'
import PasswordStrengthMeter from '@/shared/components/PasswordStrengthMeter.vue'
import { canManage } from '../lib/wallet-dialog'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'

const props = defineProps<{ address: string }>()
const emit = defineEmits<{ close: [] }>()

const wallet = useWallet()
const toast = useToast()

const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === props.address))

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

function onOpenChange(open: boolean): void {
  if (!open && !busy.value) emit('close')
}

async function submit(): Promise<void> {
  if (busy.value || !canSubmit.value) return
  if (!canManage(wallet, props.address)) {
    emit('close')
    return
  }
  busy.value = true
  error.value = null
  // Snapshot the values before the slow re-encrypt.
  const address = props.address
  const currentPw = current.value
  const nextPw = next.value
  try {
    await wallet.changePassword(address, currentPw, nextPw)
    toast.show('Password changed', 'success')
    emit('close')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not change the password'
    error.value = message === 'Invalid password' ? 'Incorrect password. Try again.' : message
    current.value = ''
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-if="target" :open="true" @update:open="onOpenChange">
    <DialogContent :class="SHEET_DIALOG">
      <form class="grid gap-[18px]" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>{{ target.name }}</DialogDescription>
        </DialogHeader>

        <div class="flex flex-col gap-3.5">
          <div class="flex flex-col gap-1.5">
            <label for="current-password" class="text-ledger text-muted-foreground">
              Current password
            </label>
            <Input
              id="current-password"
              v-model="current"
              type="password"
              autofocus
              autocomplete="current-password"
              :disabled="busy"
            />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="new-password" class="text-ledger text-muted-foreground">
              New password
            </label>
            <Input
              id="new-password"
              v-model="next"
              type="password"
              autocomplete="new-password"
              :disabled="busy"
            />
            <PasswordStrengthMeter v-if="next !== ''" :strength="strength" />
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="confirm-password" class="text-ledger text-muted-foreground">
              Confirm new password
            </label>
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
          <span class="text-xs text-muted-foreground">
            Re-encrypts this wallet in this browser. Your recovery phrase and addresses don't
            change.
          </span>
          <p v-if="error" role="alert" class="text-[13px] text-destructive">{{ error }}</p>
        </div>

        <DialogFooter :class="SHEET_FOOTER">
          <Button type="button" variant="outline" :disabled="busy" @click="emit('close')">
            Cancel
          </Button>
          <Button type="submit" :disabled="!canSubmit">
            {{ busy ? 'Re-encrypting…' : 'Change password' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

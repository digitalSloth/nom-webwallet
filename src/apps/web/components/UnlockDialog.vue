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
} from 'nom-ui'
import { useWallet } from '@/core'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'

const props = defineProps<{ address: string }>()
const emit = defineEmits<{ close: [] }>()

const wallet = useWallet()

const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === props.address))

const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

function onOpenChange(open: boolean): void {
  if (!open && !busy.value) emit('close')
}

async function submit(): Promise<void> {
  if (busy.value || password.value === '') return
  const address = props.address
  const pw = password.value
  password.value = ''
  error.value = null
  busy.value = true
  try {
    await wallet.unlockWallet(address, pw)
    emit('close')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not unlock the wallet'
    error.value = message === 'Invalid password' ? 'Incorrect password. Try again.' : message
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
          <DialogTitle>Unlock {{ target.name }}</DialogTitle>
          <DialogDescription>Enter this wallet's password.</DialogDescription>
        </DialogHeader>
        <div class="flex flex-col gap-1.5">
          <label for="unlock-password" class="text-ledger text-muted-foreground">Password</label>
          <Input
            id="unlock-password"
            v-model="password"
            type="password"
            autofocus
            autocomplete="current-password"
            :disabled="busy"
          />
          <p v-if="error" role="alert" class="text-[13px] text-destructive">{{ error }}</p>
        </div>
        <DialogFooter :class="SHEET_FOOTER">
          <Button type="button" variant="outline" :disabled="busy" @click="emit('close')">
            Cancel
          </Button>
          <Button type="submit" :disabled="busy || password === ''">
            {{ busy ? 'Unlocking…' : 'Unlock' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

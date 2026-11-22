<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Button,
  CopyButton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from 'nom-ui'
import { useWallet } from '@/core'
import { useTimedReveal } from '../lib/timed-reveal'
import { canManage } from '../lib/wallet-dialog'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'

const props = defineProps<{ address: string }>()
const emit = defineEmits<{ close: [] }>()

const wallet = useWallet()
const secret = useTimedReveal(60_000)
const phrase = secret.value

const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === props.address))
const words = computed(() => phrase.value?.split(' ') ?? [])

const password = ref('')
const error = ref<string | null>(null)
const busy = ref(false)

function close(): void {
  secret.hide()
  emit('close')
}

function onOpenChange(open: boolean): void {
  if (!open && !busy.value) close()
}

async function submit(): Promise<void> {
  if (busy.value || password.value === '') return
  if (!canManage(wallet, props.address)) {
    close()
    return
  }
  const address = props.address
  const pw = password.value
  password.value = ''
  error.value = null
  busy.value = true
  try {
    await secret.reveal(() => wallet.exportMnemonicWithPassword(address, pw))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not show the recovery phrase'
    error.value = message === 'Invalid password' ? 'Incorrect password. Try again.' : message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Dialog v-if="target" :open="true" @update:open="onOpenChange">
    <DialogContent :class="SHEET_DIALOG">
      <form v-if="phrase === null" class="grid gap-[18px]" @submit.prevent="submit">
        <DialogHeader>
          <DialogTitle>Export recovery phrase</DialogTitle>
          <DialogDescription>{{ target.name }}</DialogDescription>
        </DialogHeader>
        <div
          role="alert"
          class="flex flex-col gap-1 rounded-lg border border-warning p-3 text-[13px] leading-normal"
        >
          <span class="font-semibold">Anyone with this phrase controls this wallet's funds.</span>
          <span class="text-muted-foreground">
            NoM Wallet never asks for it. Don't share it or paste it into a site.
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="export-password" class="text-ledger text-muted-foreground">Password</label>
          <Input
            id="export-password"
            v-model="password"
            type="password"
            placeholder="Enter password"
            autofocus
            autocomplete="current-password"
            :disabled="busy"
          />
          <p v-if="error" role="alert" class="text-[13px] text-destructive">{{ error }}</p>
        </div>
        <DialogFooter :class="SHEET_FOOTER">
          <Button type="button" variant="outline" :disabled="busy" @click="close">Cancel</Button>
          <Button type="submit" :disabled="busy || password === ''">
            {{ busy ? 'Checking…' : 'Show recovery phrase' }}
          </Button>
        </DialogFooter>
      </form>

      <div v-else class="grid gap-[18px]">
        <DialogHeader>
          <DialogTitle>Recovery phrase</DialogTitle>
          <DialogDescription>{{ target.name }}</DialogDescription>
        </DialogHeader>
        <ol
          aria-label="Recovery phrase"
          class="m-0 grid list-none grid-cols-3 gap-1 rounded-lg border p-2 desktop:grid-cols-4 desktop:gap-1.5 desktop:p-2.5"
        >
          <li
            v-for="(word, i) in words"
            :key="i"
            class="flex h-[30px] items-center gap-1 rounded-md bg-muted px-1.5 font-mono text-xs desktop:gap-1.5 desktop:px-2 desktop:text-[13px]"
          >
            <span class="text-[10px] text-muted-foreground tabular-nums">
              {{ String(i + 1).padStart(2, '0') }}
            </span>
            {{ word }}
          </li>
        </ol>
        <span class="text-xs text-muted-foreground">
          Hides again when you close this dialog or after 60 seconds.
        </span>
        <DialogFooter :class="SHEET_FOOTER">
          <CopyButton :value="phrase ?? ''" variant="outline" size="icon" />
          <Button type="button" @click="close">Done</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'nom-ui'
import { useWallet } from '@/core'
import { canManage } from '../lib/wallet-dialog'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'

const props = defineProps<{ address: string }>()
const emit = defineEmits<{ close: [] }>()

// Taken at setup so the redirect still runs after this dialog unmounts.
const router = useRouter()
const wallet = useWallet()

const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === props.address))
const accountCount = computed(() => target.value?.accounts.length ?? 0)

const confirmed = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

function onOpenChange(open: boolean): void {
  if (!open && !busy.value) emit('close')
}

async function submit(): Promise<void> {
  if (busy.value || !confirmed.value) return
  if (!canManage(wallet, props.address)) {
    emit('close')
    return
  }
  busy.value = true
  error.value = null
  try {
    await wallet.deleteWallet(props.address)
    if (!wallet.hasWallets.value) await router.replace({ name: 'welcome' })
    else emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not remove the wallet'
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
          <DialogTitle>Remove {{ target.name }}?</DialogTitle>
          <DialogDescription>
            This deletes the encrypted wallet and its
            {{ accountCount === 1 ? '1 account' : `${accountCount} accounts` }} from this browser.
            Funds stay on chain — you can only get them back with the recovery phrase.
          </DialogDescription>
        </DialogHeader>
        <label
          class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm leading-snug"
        >
          <Checkbox
            :model-value="confirmed"
            class="mt-0.5"
            :disabled="busy"
            @update:model-value="confirmed = $event === true"
          />
          <span>I have the recovery phrase for {{ target.name }} saved somewhere safe.</span>
        </label>
        <p v-if="error" role="alert" class="text-[13px] text-destructive">{{ error }}</p>
        <DialogFooter :class="SHEET_FOOTER">
          <Button type="button" variant="outline" :disabled="busy" @click="emit('close')">
            Cancel
          </Button>
          <Button type="submit" variant="destructive" :disabled="!confirmed || busy">
            Remove
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

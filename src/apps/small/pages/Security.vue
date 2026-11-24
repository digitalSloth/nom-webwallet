<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { parseAutoLockMinutes, useAutoLock, useWallet } from '@/core'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useToast,
} from 'nom-ui'
import { ChevronRightIcon, LockIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'

const CHOICES = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
]

const router = useRouter()
const wallet = useWallet()
const toast = useToast()
const { minutes, setMinutes } = useAutoLock()

const saving = ref(false)

async function onSelect(value: unknown): Promise<void> {
  if (saving.value) return
  saving.value = true
  try {
    await setMinutes(parseAutoLockMinutes(Number(value)))
  } catch {
    toast.show('Could not save the auto-lock setting.', 'error')
  } finally {
    saving.value = false
  }
}

function lockAll(): void {
  wallet.lockAllWallets()
  void router.push('/')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Security" @back="router.push({ name: 'settings' })" />

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="space-y-2">
        <div class="text-ledger text-muted-foreground">Locking</div>
        <div class="divide-y rounded-lg border">
          <div class="flex items-center justify-between gap-3 px-3 py-3">
            <label for="auto-lock" class="text-sm font-medium">Auto-lock after</label>
            <Select
              :model-value="String(minutes)"
              :disabled="saving"
              @update:model-value="onSelect"
            >
              <SelectTrigger id="auto-lock" class="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in CHOICES" :key="c.value" :value="String(c.value)">
                  {{ c.label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center justify-between gap-3 px-3 py-3">
            <div>
              <div class="text-sm font-medium">Lock when the browser closes</div>
              <div class="text-xs text-muted-foreground">Keys are only ever held in memory</div>
            </div>
            <Switch
              :model-value="true"
              disabled
              aria-label="Lock when the browser closes, always on"
            />
          </div>
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-ledger text-muted-foreground">Wallets</div>
        <p class="text-xs text-muted-foreground">Recovery phrase and password are per wallet.</p>
        <ul class="divide-y rounded-lg border">
          <li v-for="w in wallet.wallets.value" :key="w.baseAddress">
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-muted"
              @click="router.push({ name: 'manage-wallet', params: { address: w.baseAddress } })"
            >
              <span class="flex-1 truncate text-sm font-medium">{{ w.name }}</span>
              <span class="text-xs text-muted-foreground">
                {{ wallet.unlockedWallets.value.includes(w.baseAddress) ? 'Unlocked' : 'Locked' }}
              </span>
              <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        </ul>
      </div>
    </div>

    <footer class="border-t px-4 py-3">
      <Button
        variant="outline"
        class="w-full"
        :disabled="wallet.unlockedWallets.value.length === 0"
        @click="lockAll"
      >
        <LockIcon /> Lock all wallets now
      </Button>
    </footer>
  </div>
</template>

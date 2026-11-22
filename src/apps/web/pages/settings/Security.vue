<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseAutoLockMinutes, useAutoLock, useAutoReceiveSetting, useWallet } from '@/core'
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useTheme,
  useToast,
} from 'nom-ui'
import { ChevronRightIcon } from 'lucide-vue-next'

const CHOICES = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
]

const wallet = useWallet()
const toast = useToast()
const { minutes, setMinutes } = useAutoLock()
const autoReceive = useAutoReceiveSetting()
const { theme, setTheme } = useTheme()

const saving = ref(false)
const savingAutoReceive = ref(false)

const stored = computed(() => wallet.wallets.value.map((w) => w.baseAddress))
const unlockedCount = computed(
  () => stored.value.filter((a) => wallet.unlockedWallets.value.includes(a)).length
)

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

async function onAutoReceiveChange(on: boolean): Promise<void> {
  if (savingAutoReceive.value) return
  savingAutoReceive.value = true
  try {
    await autoReceive.setEnabled(on)
  } catch {
    toast.show('Could not save the auto-receive setting.', 'error')
  } finally {
    savingAutoReceive.value = false
  }
}
</script>

<template>
  <section aria-labelledby="sec-h" class="rounded-xl border bg-card shadow-md">
    <h2 id="sec-h" class="border-b px-5 py-4 text-base font-semibold">Locking</h2>
    <div class="flex flex-wrap items-center gap-4 px-5 py-4">
      <div class="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <label for="auto-lock" class="text-sm font-semibold">Auto-lock after</label>
        <span class="text-[13px] text-muted-foreground">
          Unlocked wallets lock after this much inactivity.
        </span>
      </div>
      <Select :model-value="String(minutes)" :disabled="saving" @update:model-value="onSelect">
        <SelectTrigger id="auto-lock" class="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="c in CHOICES" :key="c.value" :value="String(c.value)">
            {{ c.label }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div class="flex flex-wrap items-center gap-4 border-t px-5 py-4">
      <div class="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <span class="text-sm font-semibold">Lock when the tab closes</span>
        <span class="text-[13px] text-muted-foreground">
          Keys are only ever held in memory, so closing or reloading the tab locks every wallet.
        </span>
      </div>
      <Switch :model-value="true" disabled aria-label="Lock when the tab closes, always on" />
    </div>
    <div class="flex flex-wrap items-center gap-4 border-t px-5 py-4">
      <div class="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <span class="text-sm font-semibold">Lock all wallets now</span>
        <span class="text-[13px] text-muted-foreground">
          {{ unlockedCount }} of {{ stored.length }} wallets
          {{ unlockedCount === 1 ? 'is' : 'are' }} unlocked.
        </span>
      </div>
      <Button variant="outline" :disabled="unlockedCount === 0" @click="wallet.lockAllWallets()">
        Lock all
      </Button>
    </div>
  </section>

  <section aria-labelledby="secr-h" class="rounded-xl border bg-card shadow-md">
    <h2 id="secr-h" class="border-b px-5 py-4 text-base font-semibold">Receiving</h2>
    <div class="flex flex-wrap items-center gap-4 px-5 py-4">
      <div class="flex min-w-0 flex-[1_1_280px] flex-col gap-0.5">
        <label for="auto-receive" class="text-sm font-semibold">Auto-receive</label>
        <span class="text-[13px] text-muted-foreground">
          While a wallet tab is open and unlocked, receive incoming ZNN, QSR and tokens you already
          hold. Generates PoW when plasma is low.
        </span>
      </div>
      <Switch
        id="auto-receive"
        :model-value="autoReceive.enabled.value"
        :disabled="savingAutoReceive"
        @update:model-value="onAutoReceiveChange($event === true)"
      />
    </div>
  </section>

  <section aria-labelledby="secw-h" class="rounded-xl border bg-card">
    <div class="border-b px-5 py-4">
      <h2 id="secw-h" class="text-base font-semibold">Per wallet</h2>
      <p class="mt-1 text-[13px] text-muted-foreground">
        Recovery phrase and password belong to each wallet.
      </p>
    </div>
    <RouterLink
      v-for="(w, i) in wallet.wallets.value"
      :key="w.baseAddress"
      :to="{ name: 'settings-wallets' }"
      class="flex items-center gap-3 px-5 py-3.5 text-foreground no-underline"
      :class="{ 'border-t': i > 0 }"
    >
      <span class="grow truncate text-sm font-semibold">{{ w.name }}</span>
      <span class="text-[13px] text-muted-foreground">
        {{ wallet.unlockedWallets.value.includes(w.baseAddress) ? 'Unlocked' : 'Locked' }}
      </span>
      <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </RouterLink>
  </section>

  <section
    aria-labelledby="secap-h"
    class="flex flex-wrap items-center gap-4 rounded-xl border bg-card px-5 py-4"
  >
    <h2 id="secap-h" class="min-w-0 flex-[1_1_280px] text-sm font-semibold">Dark theme</h2>
    <Switch
      :model-value="theme === 'dark'"
      aria-label="Dark theme"
      @update:model-value="setTheme($event ? 'dark' : 'light')"
    />
  </section>
</template>

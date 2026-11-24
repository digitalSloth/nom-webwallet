<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { CheckIcon, LockIcon, LockOpenIcon } from 'lucide-vue-next'
import { Button } from 'nom-ui'
import { useWallet } from '@/core'
import { shortAddress } from '../lib/format'

const props = defineProps<{ selected: string; disabled: boolean }>()
const emit = defineEmits<{ pick: [address: string]; close: [] }>()

const wallet = useWallet()
const list = ref<HTMLElement | null>(null)

const groups = computed(() =>
  wallet.wallets.value.map((w) => ({
    wallet: w,
    unlocked: wallet.unlockedWallets.value.includes(w.baseAddress),
    accounts: [...w.accounts].filter((a) => !a.hidden).sort((a, b) => a.index - b.index),
  }))
)

function options(): HTMLButtonElement[] {
  return Array.from(list.value?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
}

onMounted(async () => {
  await nextTick()
  const all = options()
  const target = all.find((o) => o.getAttribute('aria-selected') === 'true') ?? all[0]
  target?.focus()
})

function move(step: 1 | -1): void {
  const all = options()
  if (all.length === 0) return
  const current = all.indexOf(document.activeElement as HTMLButtonElement)
  const next = Math.min(all.length - 1, Math.max(0, current + step))
  all[next]?.focus()
}

function choose(address: string): void {
  if (props.disabled) return
  emit('pick', address)
}
</script>

<template>
  <div
    class="space-y-2"
    @keydown.escape.prevent="emit('close')"
    @keydown.down.prevent="move(1)"
    @keydown.up.prevent="move(-1)"
  >
    <div class="flex items-center justify-between">
      <span class="text-ledger text-muted-foreground">Choose an account</span>
      <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
    </div>

    <ul ref="list" role="listbox" aria-label="Accounts" class="space-y-2">
      <template v-for="group in groups" :key="group.wallet.baseAddress">
        <li role="presentation" class="flex items-center justify-between px-1 pt-1">
          <span class="truncate text-sm font-medium">{{ group.wallet.name }}</span>
          <span v-if="group.unlocked" class="flex items-center gap-1 text-xs text-success">
            <LockOpenIcon class="size-3.5" aria-hidden="true" /> Unlocked
          </span>
          <span v-else class="flex items-center gap-1 text-xs text-muted-foreground">
            <LockIcon class="size-3.5" aria-hidden="true" /> Locked
          </span>
        </li>
        <li v-for="a in group.accounts" :key="a.address" role="presentation">
          <button
            type="button"
            role="option"
            :aria-selected="a.address === selected"
            class="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            @click="choose(a.address)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold">{{
                a.label ?? shortAddress(a.address)
              }}</span>
              <span class="block font-mono text-xs text-muted-foreground">{{
                shortAddress(a.address)
              }}</span>
            </span>
            <CheckIcon v-if="a.address === selected" class="size-4 shrink-0" aria-hidden="true" />
          </button>
        </li>
      </template>
    </ul>
  </div>
</template>

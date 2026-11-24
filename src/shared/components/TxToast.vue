<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { TxStatus } from 'nom-ui'
import { useTrackedTransactions, useWallet } from '@/core'
import { toastEntry, txKind, txProgress } from '../lib/tx-progress'

const router = useRouter()
const { entries } = useTrackedTransactions()
const wallet = useWallet()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})

const entry = computed(() =>
  toastEntry(entries.value, wallet.activeAccountAddress.value, now.value)
)
const progress = computed(() =>
  entry.value ? txProgress(entry.value.stage, txKind(entry.value.tx)) : null
)

function open(): void {
  if (entry.value) void router.push({ name: 'tx', params: { hash: entry.value.tx.hash } })
}
</script>

<template>
  <button
    v-if="entry && progress"
    type="button"
    role="status"
    aria-live="polite"
    class="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 rounded-lg border bg-popover px-3 py-2.5 text-left text-popover-foreground shadow-lg"
    @click="open"
  >
    <span class="flex items-center gap-2">
      <TxStatus :status="progress.status" :label="progress.label" />
      <span class="flex-1 truncate text-[13px] font-semibold">{{
        entry.tx.meta?.title ?? entry.tx.label
      }}</span>
      <span class="text-xs font-medium text-info">View</span>
    </span>
    <span class="text-xs leading-snug text-muted-foreground">{{ progress.text }}</span>
    <span class="flex gap-1" aria-hidden="true">
      <span
        v-for="i in 3"
        :key="i"
        :class="['h-[3px] flex-1 rounded-full', i <= progress.reached ? 'bg-plasma' : 'bg-muted']"
      />
    </span>
  </button>
</template>

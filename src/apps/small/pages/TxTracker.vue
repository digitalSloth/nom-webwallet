<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTrackedTransactions } from '@/core'
import { Button, TxStatus } from 'nom-ui'
import TxDetails from '@/shared/components/TxDetails.vue'
import { txKind, txProgress } from '@/shared/lib/tx-progress'

const route = useRoute()
const router = useRouter()
const tracked = useTrackedTransactions()

const entry = computed(() => tracked.get(String(route.params.hash)))
const kind = computed(() => (entry.value ? txKind(entry.value.tx) : 'transfer'))
const progress = computed(() => (entry.value ? txProgress(entry.value.stage, kind.value) : null))
const finished = computed(
  () =>
    progress.value !== null &&
    (progress.value.reached === 3 ||
      progress.value.banner === 'failed' ||
      progress.value.banner === 'rejected')
)
const rejected = computed(() => progress.value?.banner === 'rejected')

function home(): void {
  void router.push('/')
}

function editAndRetry(): void {
  void router.push({ name: 'send' })
}
</script>

<template>
  <div
    v-if="!entry || !progress"
    class="flex h-full flex-col items-center justify-center gap-4 p-6"
  >
    <p class="text-sm text-muted-foreground">This transaction is not being tracked</p>
    <Button variant="outline" @click="home">Back to wallet</Button>
  </div>

  <div v-else class="flex h-full flex-col">
    <header class="flex items-center justify-between gap-2 border-b px-4 py-3.5">
      <h1 class="truncate text-base font-semibold">{{ entry.tx.meta?.title ?? entry.tx.label }}</h1>
      <TxStatus :status="progress.status" :label="progress.label" />
    </header>

    <div class="flex-1 overflow-y-auto p-4"><TxDetails :entry="entry" /></div>

    <footer class="flex flex-col gap-2 border-t px-4 py-3">
      <Button v-if="rejected" variant="default" size="lg" class="w-full" @click="editAndRetry">
        Edit and try again
      </Button>
      <Button
        v-else
        :variant="finished ? 'default' : 'outline'"
        size="lg"
        class="w-full"
        @click="home"
      >
        {{ finished ? 'Done' : 'Back to wallet' }}
      </Button>
      <span class="text-center text-xs text-muted-foreground">
        {{
          rejected
            ? 'No funds left your account'
            : entry.done
              ? 'Saved in Activity'
              : 'Keeps tracking in the wallet if you leave'
        }}
      </span>
    </footer>
  </div>
</template>

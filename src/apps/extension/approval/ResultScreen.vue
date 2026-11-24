<script setup lang="ts">
import { computed } from 'vue'
import { Address, Button, TxStatus } from 'nom-ui'
import { useTrackedTransactions } from '@/core'
import ApprovalFrame from './ApprovalFrame.vue'
import TxDetails from '@/shared/components/TxDetails.vue'
import { txKind, txProgress } from '@/shared/lib/tx-progress'

const props = defineProps<{ hash: string; nextLabel: string | null; closeLabel: string }>()
const emit = defineEmits<{ next: []; close: [] }>()

const tracked = useTrackedTransactions()

const entry = computed(() => tracked.get(props.hash))
const progress = computed(() =>
  entry.value ? txProgress(entry.value.stage, txKind(entry.value.tx)) : null
)
const finished = computed(
  () =>
    progress.value !== null && (progress.value.reached === 3 || progress.value.banner === 'failed')
)

function press(): void {
  if (props.nextLabel !== null) emit('next')
  else emit('close')
}
</script>

<template>
  <ApprovalFrame :title="entry ? (entry.tx.meta?.title ?? entry.tx.label) : 'Transaction sent'">
    <template v-if="progress" #aside>
      <TxStatus :status="progress.status" :label="progress.label" />
    </template>

    <TxDetails v-if="entry" :entry="entry" />
    <template v-else>
      <p class="text-sm">Published. Follow it in the wallet's Activity.</p>
      <Address :address="hash" :start="8" :end="6" copy />
    </template>

    <template #footer>
      <Button
        :variant="nextLabel !== null || finished ? 'default' : 'outline'"
        size="lg"
        class="w-full"
        @click="press"
      >
        {{ nextLabel ?? closeLabel }}
      </Button>
      <slot name="actions" />
      <span v-if="entry" class="text-center text-xs text-muted-foreground">
        {{ entry.done ? 'Saved in Activity' : 'Keeps tracking in the wallet if you leave' }}
      </span>
    </template>
  </ApprovalFrame>
</template>

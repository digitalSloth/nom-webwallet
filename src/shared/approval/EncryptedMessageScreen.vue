<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { InfoIcon, TriangleAlertIcon } from 'lucide-vue-next'
import { Address } from 'nom-ui'
import type { PendingApproval } from '@/core'
import { MESSAGE_WARNINGS, POW_LIMIT_NOTE, messageApprovalView } from '@/core/message-approval-view'
import { useDynamicPlasma } from '@/core/composables/useDynamicPlasma'
import RequestSite from './RequestSite.vue'
import { useScrollGate } from './scroll-gate'
import { shortAddress } from '../lib/format'

const props = defineProps<{ approval: PendingApproval; accountLabel: string | null }>()

// Emitted as true while the message body overflows its box and the user has
// not scrolled to the end, so the host keeps Send disabled until all of it
// has been in view.
const emit = defineEmits<{ unread: [unread: boolean] }>()
const bodyBox = useTemplateRef<HTMLElement>('bodyBox')
const { overflows, measure } = useScrollGate(bodyBox, (unread) => emit('unread', unread))

const dynamic = useDynamicPlasma()

const view = computed(() => {
  const action = props.approval.action
  if (action.kind !== 'sendMessage') {
    throw new Error('EncryptedMessageScreen needs a sendMessage request')
  }
  return messageApprovalView(action, dynamic.value)
})
</script>

<template>
  <div class="space-y-4">
    <RequestSite :approval="approval" action="wants to send an encrypted message" />

    <dl class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
      <dt class="self-center text-ledger text-muted-foreground">To</dt>
      <dd><Address :address="view.to" wrap copy /></dd>
      <dt class="self-center text-ledger text-muted-foreground">From</dt>
      <dd>
        {{ accountLabel }}
        <span class="font-mono text-xs text-muted-foreground">
          {{ shortAddress(approval.account) }}
        </span>
      </dd>
      <template v-if="view.replyTo">
        <dt class="self-center text-ledger text-muted-foreground">Reply to</dt>
        <dd class="font-mono text-xs">{{ view.replyTo }}</dd>
      </template>
    </dl>

    <div class="space-y-1.5">
      <span class="text-ledger text-muted-foreground">Message</span>
      <p
        ref="bodyBox"
        data-testid="message-body"
        @scroll="measure"
        :class="[
          'max-h-[168px] overflow-auto rounded-lg border bg-card p-3 text-xs leading-relaxed break-all whitespace-pre-wrap',
          view.hiddenCharCount > 0 && 'border-destructive',
        ]"
      >
        <template v-for="(part, index) in view.body" :key="index">
          <span v-if="part.hidden" class="rounded-sm bg-destructive/15 px-0.5 text-destructive">
            {{ part.text }}
          </span>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <p v-if="overflows" data-testid="scroll-note" class="text-xs font-medium text-warning">
        Scroll to read the whole message.
      </p>
      <p v-if="view.hiddenCharCount > 0" role="alert" class="text-xs font-medium text-destructive">
        This message contains {{ view.hiddenCharCount }} invisible or control
        {{ view.hiddenCharCount === 1 ? 'character' : 'characters' }}, highlighted above as U+
        codes. They are part of what is encrypted.
      </p>
    </div>

    <p class="font-mono text-xs text-muted-foreground tabular-nums">
      Size: {{ view.envelopeBytes }} bytes · base plasma
      {{ view.basePlasma.toLocaleString('en-US') }}
    </p>
    <p v-if="view.needsFusedPlasma" class="text-xs font-medium text-warning">
      {{ POW_LIMIT_NOTE }}
    </p>

    <ul class="space-y-1.5">
      <li
        v-for="warning in MESSAGE_WARNINGS"
        :key="warning"
        class="flex gap-2 rounded-lg border bg-muted px-3 py-2 text-xs leading-normal"
      >
        <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
        <span>{{ warning }}</span>
      </li>
    </ul>

    <div class="flex gap-2 rounded-lg border bg-muted px-3 py-2.5 text-xs leading-normal">
      <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
      <span>
        Approving encrypts this message in your wallet and publishes it from
        {{ accountLabel ?? shortAddress(approval.account) }}. No funds move.
      </span>
    </div>
  </div>
</template>

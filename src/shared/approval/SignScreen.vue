<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { InfoIcon } from 'lucide-vue-next'
import type { PendingApproval } from '@/core'
import { labelLineBreakRuns } from '@/core/message-approval-view'
import { encodeMessage, messageSegments } from '@/core/message-guard'
import RequestSite from './RequestSite.vue'
import { useScrollGate } from './scroll-gate'
import { shortAddress } from '../lib/format'

const props = defineProps<{ approval: PendingApproval; accountLabel: string | null }>()
// True while the message overflows its box and is not scrolled to the end.
const emit = defineEmits<{ unread: [unread: boolean] }>()
const messageBox = useTemplateRef<HTMLElement>('messageBox')
const { overflows, measure } = useScrollGate(messageBox, (unread) => emit('unread', unread))

const message = computed(() =>
  props.approval.action.kind === 'signMessage' ? props.approval.action.message : ''
)
// Rendered with white-space: pre-wrap, and with every invisible or
// reordering code point shown as a U+XXXX label, so the text on screen maps
// one to one onto the bytes that get signed.
const rawParts = computed(() => messageSegments(message.value))
// A run of 3 or more line breaks gets a label, so a gap cannot push text out of sight.
const parts = computed(() => labelLineBreakRuns(rawParts.value).segments)
const hiddenCharCount = computed(() => rawParts.value.filter((part) => part.hidden).length)
const byteLength = computed(() => encodeMessage(message.value).length)
</script>

<template>
  <div class="space-y-4">
    <RequestSite :approval="approval" action="asks you to sign a message" />

    <div class="space-y-1.5">
      <div class="flex justify-between">
        <span class="text-ledger text-muted-foreground">Message</span>
        <span class="font-mono text-[11px] text-muted-foreground tabular-nums">
          {{ byteLength }} bytes
        </span>
      </div>
      <!-- Vue drops the whitespace-only text between these tags, so the
           formatting adds nothing to the pre-wrap text. -->
      <p
        ref="messageBox"
        @scroll="measure"
        :class="[
          'max-h-[168px] overflow-auto rounded-lg border bg-card p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap',
          hiddenCharCount > 0 && 'border-destructive',
        ]"
      >
        <template v-for="(part, index) in parts" :key="index">
          <span v-if="part.hidden" class="rounded-sm bg-destructive/15 px-0.5 text-destructive">
            {{ part.text }}
          </span>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <p v-if="overflows" class="text-xs font-medium text-warning">
        Scroll to read the whole message.
      </p>
      <p v-if="hiddenCharCount > 0" role="alert" class="text-xs font-medium text-destructive">
        This message contains {{ hiddenCharCount }} invisible or control
        {{ hiddenCharCount === 1 ? 'character' : 'characters' }}, highlighted above as U+ codes.
        They are part of what you sign.
      </p>
    </div>

    <dl class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
      <dt class="text-ledger text-muted-foreground">Signer</dt>
      <dd>
        {{ accountLabel }}
        <span class="font-mono text-xs text-muted-foreground">
          {{ shortAddress(approval.account) }}
        </span>
      </dd>
    </dl>

    <div class="flex gap-2 rounded-lg border bg-muted px-3 py-2.5 text-xs leading-normal">
      <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
      <span>Signing a message is not a transaction. No funds move.</span>
    </div>
  </div>
</template>

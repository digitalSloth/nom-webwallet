<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import { InfoIcon } from 'lucide-vue-next'
import { Address, TokenIcon } from 'nom-ui'
import { usePlasmaLevel } from '@/core'
import type { PendingApproval } from '@/core'
import {
  approvalDataHex,
  coreTokenSymbol,
  dataTextView,
  decodedCallView,
  formatApprovalAmount,
} from '@/core/approval-display'
import { isEmbeddedContract } from '@/core/contract-call'
import RequestSite from './RequestSite.vue'
import { useScrollGate } from './scroll-gate'
import { shortAddress } from '../lib/format'

const props = defineProps<{ approval: PendingApproval; accountLabel: string | null }>()

const block = computed(() => {
  const action = props.approval.action
  if (action.kind !== 'sendBlock') throw new Error('TransactionScreen needs a sendBlock request')
  return action.block
})
const isSend = computed(() => block.value.blockType === 2)
const to = computed(() => block.value.toAddress.toString())
const tokenStandard = computed(() => block.value.tokenStandard.toString())
const symbol = computed(() => coreTokenSymbol(tokenStandard.value))
const hasData = computed(() => block.value.data.length > 0)
const decoded = computed(() => decodedCallView(to.value, block.value.data))
const isContract = computed(() => isEmbeddedContract(to.value))

const textView = computed(() => dataTextView(to.value, block.value.data))

// True while the data text overflows its box and the user has not scrolled to
// the end, so the host keeps Approve disabled until all of it has been in view.
const emit = defineEmits<{ unread: [unread: boolean] }>()
const textBox = useTemplateRef<HTMLElement>('textBox')
const { overflows, measure } = useScrollGate(textBox, (unread) => emit('unread', unread))

const plasma = usePlasmaLevel(props.approval.account)
const plasmaText = computed(() => {
  if (plasma.status.value === 'loading') return 'Checking…'
  if (plasma.status.value === 'unavailable' || plasma.level.value === null) return 'Unavailable'
  if (plasma.level.value === 'high') return 'High · no PoW'
  if (plasma.level.value === 'medium') return 'Medium · may need PoW'
  return 'Low · needs PoW'
})
</script>

<template>
  <div class="space-y-4">
    <RequestSite
      :approval="approval"
      :action="isSend ? 'wants to send a transaction' : 'wants to receive a transaction'"
    />

    <template v-if="isSend">
      <div class="flex flex-col items-center gap-1 rounded-xl border bg-card p-4 text-center">
        <span class="text-ledger text-muted-foreground">You send</span>
        <span class="flex items-center gap-2">
          <TokenIcon v-if="symbol" :symbol="symbol" class="size-6" />
          <span class="font-mono text-[22px] font-semibold break-all tabular-nums">
            {{ formatApprovalAmount(block.amount, tokenStandard) }}
          </span>
        </span>
      </div>

      <dl class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
        <dt class="self-center text-ledger text-muted-foreground">To</dt>
        <dd><Address :address="to" wrap copy /></dd>
        <template v-if="isContract">
          <dt class="self-center text-ledger text-muted-foreground">Contract</dt>
          <dd>{{ decoded ? `${decoded.contract} · ${decoded.method}` : 'Unknown call' }}</dd>
        </template>
        <dt class="self-center text-ledger text-muted-foreground">From</dt>
        <dd>
          {{ accountLabel }}
          <span class="font-mono text-xs text-muted-foreground">
            {{ shortAddress(approval.account) }}
          </span>
        </dd>
        <dt class="self-center text-ledger text-muted-foreground">Plasma</dt>
        <dd>{{ plasmaText }}</dd>
      </dl>

      <template v-if="hasData">
        <div v-if="decoded" class="space-y-1.5 rounded-lg bg-muted px-3 py-2.5 text-xs">
          <span class="block text-ledger text-muted-foreground">
            Decoded call · {{ decoded.contract }}.{{ decoded.method }}
          </span>
          <div v-for="arg in decoded.args" :key="arg.name" class="flex justify-between gap-2">
            <span class="text-muted-foreground">{{ arg.name }}</span>
            <span class="font-mono break-all whitespace-pre-wrap">
              <template v-for="(part, index) in arg.parts" :key="index">
                <span
                  v-if="part.hidden"
                  class="rounded-sm bg-destructive/15 px-0.5 text-destructive"
                >
                  {{ part.text }}
                </span>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
          </div>
          <p v-if="decoded.args.length === 0" class="text-muted-foreground">No arguments</p>
          <p class="text-muted-foreground">Only approve calls you expect from this site.</p>
        </div>
        <div v-else-if="textView" class="space-y-1.5">
          <span class="block text-ledger text-muted-foreground">
            {{ textView.json ? 'Data (JSON)' : 'Data (text)' }}
          </span>
          <pre
            ref="textBox"
            data-testid="data-text"
            @scroll="measure"
            :class="[
              'max-h-[168px] overflow-auto rounded-lg border bg-card p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap',
              textView.hiddenCharCount > 0 && 'border-destructive',
            ]"
          ><template v-for="(part, index) in textView.parts" :key="index"><span v-if="part.hidden" class="rounded-sm bg-destructive/15 px-0.5 text-destructive">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></pre>
          <p v-if="overflows" data-testid="scroll-note" class="text-xs font-medium text-warning">
            Scroll to read all of the data.
          </p>
          <p
            v-if="textView.hiddenCharCount > 0"
            role="alert"
            class="text-xs font-medium text-destructive"
          >
            This data contains {{ textView.hiddenCharCount }} invisible or control
            {{ textView.hiddenCharCount === 1 ? 'character' : 'characters' }}, highlighted above as
            U+ codes.
          </p>
        </div>
        <div v-else class="space-y-1 text-xs">
          <p class="font-medium text-destructive">
            This wallet cannot decode what this call does. Only approve it if you trust this site.
          </p>
          <p class="text-muted-foreground">
            Includes {{ block.data.length }} bytes of data, so this is a contract call.
          </p>
        </div>

        <details :open="decoded === null && !textView" class="rounded-lg border px-3 py-2 text-xs">
          <summary class="cursor-pointer text-muted-foreground">
            Raw data ({{ block.data.length }} bytes)
          </summary>
          <pre
            class="mt-2 max-h-40 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground"
            >{{ approvalDataHex(block.data) }}</pre
          >
        </details>
      </template>

      <div class="flex gap-2 rounded-lg border bg-muted px-3 py-2.5 text-xs leading-normal">
        <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
        <span>
          Only approve requests from sites you trust. Approving publishes this transaction from
          {{ accountLabel ?? shortAddress(approval.account) }}.
        </span>
      </div>
    </template>

    <dl v-else class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
      <dt class="self-center text-ledger text-muted-foreground">Receives</dt>
      <dd class="font-mono text-xs break-all">{{ block.fromBlockHash.toString() }}</dd>
      <dt class="self-center text-ledger text-muted-foreground">Account</dt>
      <dd>
        {{ accountLabel }}
        <span class="font-mono text-xs text-muted-foreground">
          {{ shortAddress(approval.account) }}
        </span>
      </dd>
      <dt class="self-center text-ledger text-muted-foreground">Plasma</dt>
      <dd>{{ plasmaText }}</dd>
    </dl>
  </div>
</template>

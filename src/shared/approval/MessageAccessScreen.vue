<script setup lang="ts">
import { InfoIcon } from 'lucide-vue-next'
import type { PendingApproval } from '@/core'
import RequestSite from './RequestSite.vue'
import { shortAddress } from '../lib/format'

defineProps<{ approval: PendingApproval; accountLabel: string | null }>()
</script>

<template>
  <div class="space-y-4">
    <RequestSite
      :approval="approval"
      action="asks to read your encrypted messages and inscriptions"
    />

    <dl class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[13px]">
      <dt class="text-ledger text-muted-foreground">Account</dt>
      <dd>
        {{ accountLabel }}
        <span class="font-mono text-xs text-muted-foreground">
          {{ shortAddress(approval.account) }}
        </span>
      </dd>
    </dl>

    <div class="flex gap-2 rounded-lg border bg-muted px-3 py-2.5 text-xs leading-normal">
      <InfoIcon class="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />
      <span>
        This site will be able to read every encrypted message sent to or from this account, and
        every encrypted inscription sealed to this account, while your wallet is unlocked. Turn it
        off any time in Connected sites.
      </span>
    </div>
  </div>
</template>

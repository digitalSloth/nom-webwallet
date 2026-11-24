<script setup lang="ts">
import { computed } from 'vue'
import type { PendingApproval } from '@/core'
import { approvalPeerIcon } from '@/core/approval-display'
import { urlHost } from '../lib/format'

const props = defineProps<{ approval: PendingApproval; action: string }>()

const icon = computed(() => approvalPeerIcon(props.approval))
const initial = computed(() => urlHost(props.approval.origin).charAt(0).toUpperCase())
const isWalletConnect = computed(() => props.approval.surface === 'walletconnect')
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center gap-3 rounded-lg bg-muted p-3">
      <span
        class="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-card font-semibold text-muted-foreground"
      >
        <img v-if="icon" :src="icon" alt="" class="size-full object-cover" />
        <template v-else>{{ initial }}</template>
      </span>
      <span class="flex min-w-0 flex-col">
        <span class="font-mono text-[13px] font-medium break-all">{{ approval.origin }}</span>
        <span v-if="approval.topFrameHost" class="text-xs text-muted-foreground">
          embedded in {{ approval.topFrameHost }}
        </span>
        <span v-if="isWalletConnect" class="text-xs text-muted-foreground">
          via WalletConnect · {{ approval.peer.name }}
        </span>
        <span class="text-xs text-muted-foreground">{{ action }}</span>
      </span>
    </div>

    <template v-if="isWalletConnect">
      <div
        v-if="approval.verification === 'invalid'"
        role="alert"
        class="flex gap-2 rounded-lg border border-destructive px-3 py-2.5 text-xs leading-normal"
      >
        <span class="mt-1.5 size-2 shrink-0 rounded-full bg-destructive" />
        <span class="text-destructive">
          WalletConnect could not match this dApp to {{ approval.origin }}. The request may come
          from a different site. Only approve it if you trust where it came from.
        </span>
      </div>
      <div
        v-else-if="approval.verification === 'valid'"
        role="status"
        class="flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-normal"
      >
        <span class="mt-1.5 size-2 shrink-0 rounded-full bg-success" />
        <span>WalletConnect verified this dApp's domain.</span>
      </div>
      <div
        v-else
        role="status"
        class="flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-normal"
      >
        <span class="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
        <span>WalletConnect could not verify this dApp's domain.</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { CheckIcon, XIcon } from 'lucide-vue-next'
import { Address, Button } from 'nom-ui'
import { useNetwork } from '@/core'
import type { PendingApproval } from '@/core'
import RequestSite from './RequestSite.vue'

defineProps<{
  approval: PendingApproval
  accountLabel: string | null
  changeDisabled: boolean
  endSessionHint?: string
}>()
const emit = defineEmits<{ change: [] }>()

const network = useNetwork()
</script>

<template>
  <div class="space-y-4">
    <RequestSite :approval="approval" action="wants to connect" />

    <div class="space-y-1.5">
      <span class="text-ledger text-muted-foreground">Share this account</span>
      <div class="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span v-if="accountLabel" class="text-sm font-semibold">{{ accountLabel }}</span>
          <Address :address="approval.account" :start="8" :end="6" :copy="false" />
        </div>
        <Button
          variant="link"
          size="xs"
          class="text-info"
          aria-label="Change account"
          :disabled="changeDisabled"
          @click="emit('change')"
        >
          Change
        </Button>
      </div>
    </div>

    <div class="space-y-2 text-[13px] leading-snug">
      <span class="block text-ledger text-muted-foreground">This site will be able to</span>
      <p class="flex gap-2">
        <CheckIcon class="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
        <span>
          See your address, chain ID <span class="font-mono">{{ approval.chainId }}</span> and node
          URL
        </span>
      </p>
      <p class="flex gap-2">
        <CheckIcon class="mt-px size-4 shrink-0 text-success" aria-hidden="true" />
        Ask you to send transactions or sign messages
      </p>
      <p class="flex gap-2 text-muted-foreground">
        <XIcon class="mt-px size-4 shrink-0" aria-hidden="true" />
        Move funds without asking you each time
      </p>
    </div>

    <p class="text-xs break-all text-muted-foreground">Node: {{ network.currentNode.value }}</p>
    <p class="text-xs text-muted-foreground">
      {{
        endSessionHint ??
        (approval.surface === 'walletconnect'
          ? 'End the session any time in Settings › Connected sites.'
          : 'Disconnect any time in Settings › Connected sites.')
      }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from 'nom-ui'
import { useDappApprovals, useNetwork } from '@/core'
import { useDeepLink } from '../useDeepLink'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'

const network = useNetwork()
const { currentApproval } = useDappApprovals()
const { request, preview, isConnecting, armed, failure, confirm, cancel } = useDeepLink({
  paused: () => currentApproval.value !== null,
})
</script>

<template>
  <!-- A pending dApp request goes first: one modal at a time. -->
  <Dialog
    :open="request !== null && currentApproval === null"
    @update:open="(open) => !open && cancel()"
  >
    <DialogContent :class="SHEET_DIALOG">
      <DialogHeader>
        <DialogTitle>Connect to a different network?</DialogTitle>
        <DialogDescription>
          A link is asking this wallet to connect to the following network. Only continue if you
          trust where this link came from.
        </DialogDescription>
      </DialogHeader>

      <dl
        v-if="request"
        class="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 rounded-lg bg-muted p-3.5 text-[13px]"
      >
        <template v-if="request.node">
          <dt class="self-center text-ledger text-muted-foreground">Node</dt>
          <dd class="font-mono break-all">{{ request.node }}</dd>
        </template>
        <template v-if="preview?.showChainId">
          <dt class="self-center text-ledger text-muted-foreground">Chain ID</dt>
          <dd class="font-mono">
            {{ preview.entry.chainId }}
            <span
              v-if="preview.entry.chainId !== network.chainId.value"
              class="text-muted-foreground"
              >(now {{ network.chainId.value }}, this switches the chain)</span
            >
          </dd>
        </template>
        <template v-if="preview?.showNetworkId">
          <dt class="self-center text-ledger text-muted-foreground">Network ID</dt>
          <dd class="font-mono">
            {{ preview.entry.networkId }}
            <span
              v-if="preview.entry.networkId !== network.networkId.value"
              class="text-muted-foreground"
              >(now {{ network.networkId.value }})</span
            >
          </dd>
        </template>
      </dl>

      <p v-if="failure" role="alert" class="text-[13px] text-destructive">{{ failure }}</p>

      <DialogFooter :class="SHEET_FOOTER">
        <Button variant="outline" :disabled="isConnecting" @click="cancel">Cancel</Button>
        <Button :disabled="isConnecting || !armed" @click="confirm">
          {{ isConnecting ? 'Connecting…' : failure ? 'Retry' : 'Connect' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

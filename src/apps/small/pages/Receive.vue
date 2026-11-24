<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import type { AccountBlock } from 'znn-typescript-sdk'
import { useAccount, useIncoming, useWallet } from '@/core'
import { Alert, Amount, Button, CopyButton, Spinner, TokenIcon } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import QrCode from '@/shared/components/QrCode.vue'
import { formatAmount } from '@/shared/lib/amount'
import { relativeTime, shortAddress } from '@/shared/lib/format'
import { leaveAllowed } from '@/apps/small/routes'
import { injectSmallHost } from '@/apps/small/host'

const PAGE_SIZE = 10

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)

const host = injectSmallHost()

const incoming = useIncoming({ address: active, account, onLocked: () => host.requestUnlock() })
const { blocks, busy, error, bulkFailure, more, receiveOne } = incoming

const accountLabel = () =>
  wallet.activeWallet.value?.accounts.find((a) => a.address === active())?.label ?? 'Account'

onBeforeRouteLeave((to) => leaveAllowed(busy.value, to))

onMounted(() => void incoming.loadFirstPage())

// Auto-receive changes the count when it takes a block, so the list reloads.
watch(account.unreceivedCount, () => void incoming.loadFirstPage())

function amountText(block: AccountBlock): string {
  return block.token
    ? formatAmount(BigInt(block.amount.toString()), block.token.decimals)
    : block.amount.toString()
}

async function openTracker(hash: string | null): Promise<void> {
  if (hash) await router.replace({ name: 'tx', params: { hash } })
}

async function receiveAll(): Promise<void> {
  await openTracker(await incoming.receiveAll())
}

async function retryAll(): Promise<void> {
  await openTracker(await incoming.retryAll())
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Receive" top-level>
      <span class="text-xs text-muted-foreground">{{ accountLabel() }}</span>
    </PageHeader>

    <div v-if="!active()" class="flex-1 py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div v-else class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="flex flex-col items-center gap-2 rounded-lg border bg-card px-4 py-4">
        <QrCode :value="active()!" />
        <div class="text-ledger text-muted-foreground">Your address</div>
        <div class="text-center font-mono text-xs break-all">{{ active() }}</div>
        <CopyButton :value="active()!" variant="outline" size="sm" class="w-auto px-3">
          Copy address
        </CopyButton>
      </div>

      <div class="space-y-2">
        <div class="text-ledger text-muted-foreground">
          Waiting to receive · {{ account.unreceivedCount.value }}
        </div>
        <ul v-if="blocks.length > 0" class="divide-y rounded-lg border">
          <li
            v-for="block in blocks"
            :key="block.hash.toString()"
            class="flex items-center gap-3 px-3 py-2.5"
          >
            <TokenIcon :symbol="block.token?.symbol ?? '?'" class="size-7" />
            <div class="min-w-0 flex-1">
              <Amount
                :value="amountText(block)"
                :decimals="Math.min(block.token?.decimals ?? 0, 4)"
                :symbol="block.token?.symbol ?? 'Unknown'"
                class="text-sm"
              />
              <div class="truncate text-xs text-muted-foreground">
                from {{ shortAddress(block.address.toString()) }} ·
                {{
                  block.confirmationDetail
                    ? relativeTime(block.confirmationDetail.momentumTimestamp * 1000)
                    : 'pending'
                }}
              </div>
            </div>
            <Button variant="ghost" size="sm" :disabled="busy" @click="receiveOne(block)">
              Receive
            </Button>
          </li>
        </ul>
        <p v-if="more" class="text-xs text-muted-foreground">
          Showing the first {{ PAGE_SIZE }}. Receive these to see the rest.
        </p>
        <Alert v-if="error" variant="destructive" class="text-sm">{{ error }}</Alert>
        <Alert v-if="bulkFailure" variant="destructive" class="space-y-2 text-sm">
          <p>{{ bulkFailure }}</p>
          <Button variant="outline" size="sm" :disabled="busy" @click="retryAll">Try again</Button>
        </Alert>
        <p class="text-xs text-muted-foreground">
          Funds sent to you show in your balance once you receive them. Each receive is a
          transaction, so low plasma means PoW.
        </p>
      </div>
    </div>

    <footer v-if="blocks.length > 0" class="border-t px-4 py-3">
      <Button class="w-full" size="lg" :disabled="busy" @click="receiveAll">
        <Spinner v-if="busy" />
        Receive all {{ blocks.length }}
      </Button>
    </footer>
  </div>
</template>

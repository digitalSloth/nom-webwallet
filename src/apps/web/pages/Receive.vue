<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { AccountBlock } from 'znn-typescript-sdk'
import { useAccount, useIncoming, useWallet } from '@/core'
import { Address, Alert, Amount, Button, CopyButton, Spinner, TokenIcon } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import QrCode from '@/shared/components/QrCode.vue'
import { formatAmount } from '@/shared/lib/amount'
import { explorerAccountUrl, relativeTime } from '@/shared/lib/format'
import { qrFileName, qrPng } from '@/shared/lib/qr-png'

const PAGE_SIZE = 10

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)

const incoming = useIncoming({
  address: active,
  account,
  onLocked: () => wallet.refreshLockState(),
})
const { blocks, busy, error, bulkFailure, more } = incoming

const qrError = ref<string | null>(null)

const accountLine = computed(() => {
  const w = wallet.activeWallet.value
  const label = w?.accounts.find((a) => a.address === active())
  return `${label?.label || `Account ${(label?.index ?? 0) + 1}`} · ${w?.name ?? ''}`
})

onMounted(() => void incoming.loadFirstPage())

// Auto-receive changes the count when it takes a block, so the list reloads.
watch(account.unreceivedCount, () => void incoming.loadFirstPage())

function amountText(block: AccountBlock): string {
  return block.token
    ? formatAmount(BigInt(block.amount.toString()), block.token.decimals)
    : block.amount.toString()
}

// The lock check runs here as well as in useIncoming, which only reads the state it is given.
function ready(): boolean {
  wallet.refreshLockState()
  return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
}

async function openTracker(hash: string | null): Promise<void> {
  if (hash) await router.replace({ name: 'tx', params: { hash } })
}

async function receiveOne(block: AccountBlock): Promise<void> {
  if (!ready()) return
  await incoming.receiveOne(block)
}

async function receiveAll(): Promise<void> {
  if (!ready()) return
  await openTracker(await incoming.receiveAll())
}

async function retryAll(): Promise<void> {
  if (!ready()) return
  await openTracker(await incoming.retryAll())
}

async function downloadQr(): Promise<void> {
  const address = active()
  if (!address) return
  qrError.value = null
  try {
    const blob = await qrPng(address)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = qrFileName(address)
    link.click()
    URL.revokeObjectURL(url)
  } catch {
    qrError.value = 'Could not create the QR image.'
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Receive</h1>
      <p class="text-sm text-muted-foreground">
        Share your address to get paid. Incoming funds show in your balance once you receive them.
      </p>
    </div>

    <div v-if="!active()" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div v-else class="flex flex-wrap items-start gap-5">
      <section
        aria-label="Your address"
        class="flex flex-[1_1_320px] flex-col items-center gap-4 rounded-xl border bg-card p-6 shadow-md"
      >
        <QrCode :value="active()!" class="size-[220px]! p-3!" />
        <span class="text-ledger text-muted-foreground">{{ accountLine }}</span>
        <span class="max-w-[320px] text-center font-mono text-[15px] leading-relaxed break-all">
          {{ active() }}
        </span>
        <div class="grid w-full max-w-[320px] grid-cols-2 gap-2">
          <CopyButton :value="active()!" class="w-full">Copy address</CopyButton>
          <Button variant="outline" class="w-full" @click="downloadQr">Download QR</Button>
        </div>
        <Alert v-if="qrError" variant="destructive" class="w-full max-w-[320px] text-sm">
          {{ qrError }}
        </Alert>
      </section>

      <section
        aria-labelledby="web-receive-incoming"
        class="min-w-0 flex-[2_1_480px] rounded-xl border bg-card"
      >
        <div class="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <h2 id="web-receive-incoming" class="grow text-base font-semibold">Waiting to receive</h2>
          <Button v-if="blocks.length > 0" :disabled="busy" @click="receiveAll">
            <Spinner v-if="busy" />
            Receive all {{ blocks.length }}
          </Button>
        </div>

        <p v-if="blocks.length === 0" class="px-5 py-6 text-sm text-muted-foreground">
          Nothing waiting to receive.
        </p>
        <div v-else class="relative overflow-x-auto">
          <table class="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr class="text-left text-ledger text-muted-foreground">
                <th class="px-5 py-2.5 font-medium">Amount</th>
                <th class="px-3 py-2.5 font-medium">From</th>
                <th class="px-3 py-2.5 font-medium">Sent</th>
                <th class="px-5 py-2.5"><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="block in blocks" :key="block.hash.toString()" class="border-t">
                <td class="px-5 py-3">
                  <span class="flex items-center gap-2.5">
                    <TokenIcon :symbol="block.token?.symbol ?? '?'" class="size-6" />
                    <Amount
                      :value="amountText(block)"
                      :decimals="block.token?.decimals ?? 0"
                      :symbol="block.token?.symbol ?? 'Unknown'"
                      dim-trailing-zeros
                      class="font-semibold"
                    />
                  </span>
                </td>
                <td class="px-3 py-3">
                  <Address
                    :address="block.address.toString()"
                    :start="8"
                    :end="6"
                    :copy="false"
                    :href="explorerAccountUrl(block.address.toString())"
                  />
                </td>
                <td class="px-3 py-3 text-muted-foreground">
                  {{
                    block.confirmationDetail
                      ? relativeTime(block.confirmationDetail.momentumTimestamp * 1000)
                      : 'pending'
                  }}
                </td>
                <td class="px-5 py-3 text-right">
                  <Button variant="outline" size="sm" :disabled="busy" @click="receiveOne(block)">
                    Receive
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="more || error || bulkFailure" class="space-y-2 border-t px-5 py-3">
          <p v-if="more" class="text-xs text-muted-foreground">
            Showing the first {{ PAGE_SIZE }}. Receive these to see the rest.
          </p>
          <Alert v-if="error" variant="destructive" class="text-sm">{{ error }}</Alert>
          <Alert v-if="bulkFailure" variant="destructive" class="space-y-2 text-sm">
            <p>{{ bulkFailure }}</p>
            <Button variant="outline" size="sm" :disabled="busy" @click="retryAll">
              Try again
            </Button>
          </Alert>
        </div>
        <p class="border-t px-5 py-3.5 text-xs leading-normal text-muted-foreground">
          Each receive is a transaction. With low plasma the wallet generates PoW first and blocks
          the page until it's sent.
        </p>
      </section>
    </div>
  </div>
</template>

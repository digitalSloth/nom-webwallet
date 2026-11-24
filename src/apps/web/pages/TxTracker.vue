<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBlockLookup, useNetwork, useTrackedTransactions, useWallet } from '@/core'
import type { TrackedEntry } from '@/core'
import { Address, Amount, Button, Spinner, TxStatus } from 'nom-ui'
import TxTimeline from '@/shared/components/TxTimeline.vue'
import { explorerBlockUrl, shortAddress, urlHost } from '@/shared/lib/format'
import { formatAmount } from '@/shared/lib/amount'
import { sendDraft } from '@/shared/lib/send-draft'
import { rejectedBanner, txKind, txProgress } from '@/shared/lib/tx-progress'
import { parseBlockHash, txSubline } from '../lib/activity'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const network = useNetwork()
const tracked = useTrackedTransactions()

const hashParam = computed(() => String(route.params.hash))
const stored = computed(() => tracked.get(hashParam.value))
// A hash this tab does not track is read from the node once, without tracking it.
const looked = shallowRef<TrackedEntry | null>(null)
const lookupState = ref<'idle' | 'loading' | 'missing' | 'failed'>('idle')
const entry = computed(() => stored.value ?? looked.value)
let generation = 0

async function run(): Promise<void> {
  const current = ++generation
  looked.value = null
  const hash = parseBlockHash(hashParam.value)
  if (stored.value || hash === null) {
    lookupState.value = 'idle'
    return
  }
  lookupState.value = 'loading'
  try {
    const found = await useBlockLookup().lookup(hash)
    if (current !== generation) return
    looked.value = found
    lookupState.value = found ? 'idle' : 'missing'
  } catch (err) {
    if (current !== generation) return
    console.error('Failed to read block:', err)
    lookupState.value = 'failed'
  }
}

watch(hashParam, run, { immediate: true })
const kind = computed(() => (entry.value ? txKind(entry.value.tx) : 'transfer'))
const progress = computed(() => (entry.value ? txProgress(entry.value.stage, kind.value) : null))
const meta = computed(() => entry.value?.tx.meta)
const rejected = computed(() => entry.value?.stage.kind === 'rejected')
const node = computed(() => urlHost(network.currentNode.value))

const amountText = computed(() => {
  const m = meta.value
  if (!m?.amount || m.decimals === undefined || !m.symbol) return null
  return formatAmount(BigInt(m.amount), m.decimals)
})

const subline = computed(() => {
  const current = entry.value
  if (!current) return ''
  let own: string | null = null
  for (const w of wallet.wallets.value) {
    const found = w.accounts.find((a) => a.address === current.tx.address)
    if (found) {
      own = `${found.label || `Account ${found.index + 1}`} · ${w.name}`
      break
    }
  }
  return txSubline(current.tx, own, shortAddress)
})

function home(): void {
  void router.push({ name: 'home' })
}

function editAndRetry(): void {
  void router.push({ name: 'send' })
}

function sendAnother(): void {
  sendDraft.value = null
  void router.push({ name: 'send' })
}
</script>

<template>
  <div
    v-if="!entry || !progress"
    class="mx-auto flex max-w-[880px] flex-col items-center gap-4 py-16"
  >
    <template v-if="lookupState === 'loading'">
      <Spinner class="size-6" />
      <p class="text-sm text-muted-foreground">Reading this block from {{ node }}…</p>
    </template>
    <template v-else-if="lookupState === 'missing'">
      <p class="text-sm text-muted-foreground">No block with this hash on {{ node }}.</p>
      <Button variant="outline" @click="home">Back to dashboard</Button>
    </template>
    <template v-else-if="lookupState === 'failed'">
      <p class="text-sm text-muted-foreground">Couldn't read this block from {{ node }}.</p>
      <div class="flex gap-3">
        <Button @click="run">Try again</Button>
        <Button variant="outline" @click="home">Back to dashboard</Button>
      </div>
    </template>
    <template v-else>
      <p class="text-sm text-muted-foreground">This transaction isn't tracked in this tab.</p>
      <Button variant="outline" @click="home">Back to dashboard</Button>
    </template>
  </div>

  <div v-else class="mx-auto flex max-w-[880px] flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="grow text-3xl font-semibold tracking-tight">
        {{ entry.tx.meta?.title ?? entry.tx.label }}
      </h1>
      <TxStatus :status="progress.status" :label="progress.label" />
    </div>

    <section class="flex flex-wrap gap-8 rounded-xl border bg-card p-6 shadow-md">
      <div class="flex flex-[1_1_260px] flex-col gap-1.5">
        <template v-if="amountText !== null">
          <span class="text-ledger text-muted-foreground">Amount</span>
          <Amount
            :value="amountText"
            :decimals="meta?.decimals ?? 0"
            :symbol="meta?.symbol"
            dim-trailing-zeros
            class="text-[28px] font-semibold"
          />
        </template>
        <span class="text-[13px] text-muted-foreground">{{ subline }}</span>
        <dl class="mt-4 grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          <template v-if="!rejected">
            <dt class="self-center text-ledger text-muted-foreground">Hash</dt>
            <dd class="m-0">
              <Address
                :address="entry.tx.hash"
                :start="10"
                :end="8"
                copy
                :href="explorerBlockUrl(entry.tx.hash)"
              />
            </dd>
          </template>
          <template v-if="meta?.recipient">
            <dt class="self-center text-ledger text-muted-foreground">To</dt>
            <dd class="m-0"><Address :address="meta.recipient" :start="10" :end="8" copy /></dd>
          </template>
          <dt class="self-center text-ledger text-muted-foreground">Fee</dt>
          <dd class="m-0 font-mono">0</dd>
        </dl>
      </div>

      <div class="flex-[1_1_280px]">
        <TxTimeline :stage="entry.stage" :kind="kind" :node="node" />
      </div>
    </section>

    <div
      v-if="progress.banner === 'failed'"
      role="alert"
      class="rounded-lg border border-destructive px-3.5 py-3 text-[13px] text-destructive"
    >
      Confirmed in momentum {{ progress.momentum?.toLocaleString('en-US') }}, but the contract call
      failed. Check the explorer for the reason.
    </div>
    <div
      v-else-if="entry.stage.kind === 'rejected'"
      role="alert"
      class="rounded-lg border border-destructive px-3.5 py-3 text-[13px] text-destructive"
    >
      {{ rejectedBanner(entry.stage.reason) }}
      <button type="button" class="font-medium" @click="editAndRetry">Edit and try again</button>
    </div>
    <div
      v-else-if="progress.banner === 'stale'"
      role="status"
      class="rounded-lg border border-warning px-3.5 py-3 text-[13px]"
    >
      Still waiting after several minutes. The transaction may still confirm. Check the explorer.
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button @click="home">Back to dashboard</Button>
      <Button variant="outline" @click="sendAnother">Send another</Button>
      <span v-if="rejected" class="text-[13px] text-muted-foreground">
        No funds left your account
      </span>
      <span v-else-if="stored" class="text-[13px] text-muted-foreground">
        Leaving this page keeps tracking in a toast.
      </span>
    </div>
  </div>
</template>

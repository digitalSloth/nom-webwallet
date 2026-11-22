<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { QSR_ZTS } from 'znn-typescript-sdk'
import type { FusionEntry } from 'znn-typescript-sdk'
import { useAccount, useNetwork, usePlasma, usePlasmaBot, useWallet } from '@/core'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { MIN_FUSE_AMOUNT_QSR } from '@/config'
import { Address, Alert, Amount, Badge, Button, Input, Spinner } from 'nom-ui'
import { WalletIcon, ZapIcon } from 'lucide-vue-next'
import { trackSend } from '@/shared/lib/unresolved-send'
import { formatAmount, isValidAddress } from '@/shared/lib/amount'
import {
  canCancelFusion,
  fusedAtHeight,
  lowestAvailableTier,
  parseFuseAmount,
  plasmaBotErrorText,
  plasmaPercent,
} from '@/shared/lib/plasma'

const BOT_POLL_MS = 2_000

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const network = useNetwork()
const plasma = usePlasma()
const plasmaBot = usePlasmaBot()

const accountLabel = computed(() => {
  const a = wallet.activeWallet.value?.accounts.find((x) => x.address === active())
  return a ? a.label || `Account ${a.index + 1}` : 'Account'
})

let alive = true
const fusionsFor = ref<string | null>(null)
const submitting = ref(false)
onBeforeUnmount(() => {
  alive = false
})

onMounted(() => {
  const address = active()
  if (!address) return
  plasma.fusionEntries.value = []
  void plasma.loadFusionEntries(address).then(() => {
    if (alive && active() === address) fusionsFor.value = address
  })
  void network.loadFrontierMomentum()
  void plasmaBot.loadStats()
})

const busy = computed(() => submitting.value || plasma.isFusing.value || plasma.isCanceling.value)

// The shared fusion list only counts once it was loaded for the active account.
const fusions = computed(() => (fusionsFor.value === active() ? plasma.fusionEntries.value : []))

// Locked wallets show the locked overlay; the check re-reads the session first.
function unlocked(): boolean {
  wallet.refreshLockState()
  return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
}

const LEVELS = {
  low: {
    label: 'Low',
    class: 'text-warning',
    hint: 'Each send generates PoW on this device first, which is slower. Add plasma to send instantly.',
  },
  medium: {
    label: 'Medium',
    class: 'text-info',
    hint: 'Some sends may need PoW on this device. Add plasma to send instantly.',
  },
  high: {
    label: 'High',
    class: 'text-success',
    hint: 'Sends go out instantly with no PoW.',
  },
} as const

const level = computed(() => LEVELS[account.plasmaLevel.value])
const percent = computed(() => plasmaPercent(account.currentPlasma.value, account.maxPlasma.value))

// Get free plasma
const tier = computed(() => lowestAvailableTier(plasmaBot.stats.value, plasmaBot.statsStatus.value))
const waiting = ref(false)
const botError = ref<string | null>(null)
const botArrived = ref(false)

const statusLine = computed<{ text: string; warning: boolean } | null>(() => {
  switch (plasmaBot.statsStatus.value) {
    case 'checking':
      return { text: 'Checking plazma.bot…', warning: false }
    case 'online':
      return tier.value === null
        ? { text: 'plazma.bot is low on QSR right now.', warning: true }
        : {
            text: `plazma.bot online · ${plasmaBot.stats.value?.qsrAvailable ?? 0} QSR available`,
            warning: false,
          }
    case 'unreachable':
      return { text: 'Couldn’t reach plazma.bot. You can still try.', warning: false }
    default:
      return null
  }
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requestBot(): Promise<void> {
  const address = active()
  if (!address || tier.value === null) return
  botError.value = null
  botArrived.value = false
  const start = account.currentPlasma.value
  try {
    await plasmaBot.fuse(address, tier.value)
  } catch (err) {
    botError.value = plasmaBotErrorText(err)
    return
  }
  waiting.value = true
  try {
    while (alive) {
      await delay(BOT_POLL_MS)
      if (!alive) return
      await account.loadPlasmaInfo()
      if (account.currentPlasma.value > start) {
        botArrived.value = true
        return
      }
    }
  } finally {
    waiting.value = false
  }
}

// Fuse QSR
const amount = ref('')
const beneficiaryInput = ref(active() ?? '')
const fuseError = ref<string | null>(null)
const unknownOutcome = ref(false)
trackSend(submitting, unknownOutcome)

const qsrRaw = computed(() => {
  const row = account.balances.value.find((b) => b.tokenStandard === QSR_ZTS.toString())
  return row ? BigInt(row.balance) : 0n
})
const fuse = computed(() => parseFuseAmount(amount.value, qsrRaw.value))

const beneficiary = computed(() => beneficiaryInput.value.trim())
const beneficiaryValid = computed(() => isValidAddress(beneficiary.value))
const beneficiaryError = computed(() =>
  beneficiary.value !== '' && !beneficiaryValid.value ? 'Enter a valid z1 address' : null
)

async function fuseQsr(): Promise<void> {
  const raw = fuse.value.raw
  if (raw === null || !beneficiaryValid.value) return
  if (!unlocked()) return
  const activeWallet = wallet.activeWallet.value
  const address = active()
  if (!activeWallet || !address) return
  if (submitting.value) return
  fuseError.value = null
  submitting.value = true
  try {
    const block = await plasma.fuseQsr(activeWallet, address, beneficiary.value, raw, {
      kind: 'contract',
      title: 'Plasma · Fuse',
      progress: `Fusing ${formatAmount(raw, 8)} QSR`,
      amount: raw.toString(),
      decimals: 8,
      symbol: 'QSR',
      tokenStandard: QSR_ZTS.toString(),
    })
    await router.replace({ name: 'tx', params: { hash: block.hash.toString() } })
  } catch (err) {
    fuseError.value = err instanceof Error ? err.message : 'Failed to fuse QSR'
    // After a timeout the fusion may still publish, so Fuse cannot be repeated from here.
    if (fuseError.value === SEND_TIMEOUT_MESSAGE) {
      unknownOutcome.value = true
    }
  } finally {
    submitting.value = false
  }
}

// Active fusions
const cancelError = ref<string | null>(null)

async function cancelFusion(entry: FusionEntry): Promise<void> {
  if (!unlocked()) return
  const activeWallet = wallet.activeWallet.value
  const address = active()
  if (!activeWallet || !address) return
  if (submitting.value || fusionsFor.value !== address) return
  cancelError.value = null
  submitting.value = true
  try {
    const block = await plasma.cancelFusion(activeWallet, address, entry.id.toString(), {
      kind: 'contract',
      title: 'Plasma · Cancel fusion',
      progress: 'Cancelling fusion',
    })
    await router.replace({ name: 'tx', params: { hash: block.hash.toString() } })
  } catch (err) {
    cancelError.value = err instanceof Error ? err.message : 'Failed to cancel fusion'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Plasma</h1>
      <p class="text-sm text-muted-foreground">
        Plasma lets transactions go out instantly. Without it, the wallet generates PoW on this
        device first.
      </p>
    </div>

    <div v-if="!active()" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <section
        aria-label="Plasma level"
        class="flex flex-wrap items-center gap-6 rounded-xl border bg-card px-6 py-5 shadow-md"
      >
        <div class="flex flex-[2_1_320px] flex-col gap-2.5">
          <span class="flex items-baseline justify-between">
            <span class="text-ledger text-muted-foreground">Plasma level · {{ accountLabel }}</span>
            <span :class="['text-sm font-semibold', level.class]">{{ level.label }}</span>
          </span>
          <div
            class="h-2.5 overflow-hidden rounded-full bg-muted"
            role="img"
            :aria-label="`Plasma ${percent} percent`"
          >
            <div class="h-full rounded-full bg-plasma" :style="{ width: `${percent}%` }" />
          </div>
          <span class="text-[13px] text-muted-foreground">{{ level.hint }}</span>
        </div>
        <div class="flex flex-[1_1_160px] flex-col gap-1">
          <span class="text-ledger text-muted-foreground">QSR fused</span>
          <Amount
            :value="formatAmount(BigInt(account.fusedQsr.value), 8)"
            :decimals="2"
            symbol="QSR"
            class="text-xl font-semibold"
          />
        </div>
      </section>

      <div class="flex flex-wrap items-stretch gap-5">
        <section
          aria-labelledby="web-plasma-bot"
          class="flex flex-[1_1_320px] flex-col gap-3 rounded-xl border bg-card p-5"
        >
          <h2 id="web-plasma-bot" class="text-base font-semibold">Get free plasma</h2>
          <p class="text-sm leading-relaxed text-muted-foreground">
            No QSR?
            <a href="https://plazma.bot" target="_blank" rel="noopener noreferrer" class="text-info"
              >plazma.bot</a
            >
            fuses plasma to your current account for free. It arrives within a few momentums.
          </p>
          <p
            v-if="statusLine"
            :class="['text-xs', statusLine.warning ? 'text-warning' : 'text-muted-foreground']"
          >
            {{ statusLine.text }}
          </p>
          <div class="grow" />
          <div
            v-if="waiting"
            role="status"
            class="flex flex-col gap-2 rounded-lg bg-muted p-3 text-sm"
          >
            <span class="font-semibold">Waiting for plasma to arrive…</span>
            <div
              role="progressbar"
              aria-label="Waiting for plasma"
              class="relative h-1 overflow-hidden rounded-full bg-border"
            >
              <div
                class="pow-indeterminate absolute inset-y-0 left-0 w-[35%] rounded-full bg-plasma"
              />
            </div>
            <span class="text-xs text-muted-foreground">
              Shows here once the next momentum confirms it. You can close this tab.
            </span>
          </div>
          <Button
            v-else
            class="w-full"
            size="lg"
            :disabled="tier === null || plasmaBot.isFusing.value"
            @click="requestBot"
          >
            <template v-if="plasmaBot.isFusing.value"><Spinner /> Requesting…</template>
            <template v-else><ZapIcon /> Get free plasma</template>
          </Button>
          <p v-if="botArrived" class="text-sm text-success">Plasma arrived.</p>
          <Alert v-if="botError" variant="destructive" class="text-sm">{{ botError }}</Alert>
        </section>

        <form
          aria-labelledby="web-plasma-fuse"
          class="flex flex-[1_1_320px] flex-col gap-3.5 rounded-xl border bg-card p-5"
          @submit.prevent
        >
          <h2 id="web-plasma-fuse" class="text-base font-semibold">Fuse QSR</h2>
          <div class="flex flex-col gap-1.5">
            <span class="flex items-baseline justify-between">
              <label for="web-fuse-amount" class="text-ledger text-muted-foreground">
                Amount (QSR)
              </label>
              <span class="text-xs text-muted-foreground">
                Min <span class="font-mono">{{ MIN_FUSE_AMOUNT_QSR }}</span> · Available
                <span class="font-mono tabular-nums">{{ formatAmount(qsrRaw, 8) }}</span>
              </span>
            </span>
            <Input
              id="web-fuse-amount"
              v-model="amount"
              numeric
              placeholder="10"
              autocomplete="off"
            />
            <p v-if="fuse.error" class="text-xs text-destructive">{{ fuse.error }}</p>
          </div>
          <div class="flex flex-col gap-1.5">
            <label for="web-fuse-beneficiary" class="text-ledger text-muted-foreground">
              Beneficiary
            </label>
            <Input
              id="web-fuse-beneficiary"
              v-model="beneficiaryInput"
              autocomplete="off"
              spellcheck="false"
              class="font-mono text-[13px]"
            />
            <p v-if="beneficiaryError" class="text-xs text-destructive">{{ beneficiaryError }}</p>
            <span class="text-xs text-muted-foreground">
              Defaults to this account. Fused QSR stays yours; cancel later to get it back.
            </span>
          </div>
          <Alert v-if="fuseError" variant="destructive" class="text-sm">{{ fuseError }}</Alert>
          <Button v-if="unknownOutcome" as-child size="lg" class="w-full">
            <RouterLink :to="{ name: 'activity' }">Check activity</RouterLink>
          </Button>
          <Button
            v-else
            class="w-full"
            size="lg"
            :disabled="fuse.raw === null || !beneficiaryValid || busy"
            @click="fuseQsr"
          >
            <template v-if="plasma.isFusing.value"><Spinner /> Fusing…</template>
            <template v-else-if="fuse.raw !== null"
              >Fuse {{ formatAmount(fuse.raw, 8) }} QSR</template
            >
            <template v-else>Fuse QSR</template>
          </Button>
        </form>
      </div>

      <section aria-labelledby="web-plasma-fusions" class="rounded-xl border bg-card">
        <div class="border-b px-5 py-4">
          <h2 id="web-plasma-fusions" class="text-base font-semibold">Active fusions</h2>
        </div>
        <div v-if="plasma.isLoading.value && fusions.length === 0" class="flex justify-center py-4">
          <Spinner />
        </div>
        <p v-else-if="fusions.length === 0" class="px-5 py-4 text-sm text-muted-foreground">
          No active fusions
        </p>
        <div v-else class="relative overflow-x-auto">
          <table class="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr class="text-ledger text-muted-foreground">
                <th class="px-5 py-2.5 text-left font-medium">Amount</th>
                <th class="px-3 py-2.5 text-left font-medium">Beneficiary</th>
                <th class="px-3 py-2.5 text-right font-medium">Fused at height</th>
                <th class="px-5 py-2.5"><span class="sr-only">Action</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in fusions" :key="entry.id.toString()" class="border-t">
                <td class="px-5 py-3">
                  <Amount
                    :value="formatAmount(BigInt(entry.qsrAmount.toString()), 8)"
                    :decimals="2"
                    symbol="QSR"
                    class="font-semibold"
                  />
                </td>
                <td class="px-3 py-3">
                  <Address :address="entry.beneficiary.toString()" :start="8" :end="6" />
                </td>
                <td class="px-3 py-3 text-right font-mono tabular-nums">
                  {{ fusedAtHeight(entry).toLocaleString('en-US') }}
                </td>
                <td class="px-5 py-3 text-right">
                  <Button
                    v-if="canCancelFusion(entry, network.currentMomentum.value)"
                    variant="outline"
                    size="sm"
                    :disabled="busy"
                    @click="cancelFusion(entry)"
                  >
                    {{
                      plasma.cancelingFusionId.value === entry.id.toString()
                        ? 'Cancelling…'
                        : 'Cancel'
                    }}
                  </Button>
                  <Badge v-else variant="secondary">Locked</Badge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Alert v-if="cancelError" variant="destructive" class="m-5 text-sm">{{
          cancelError
        }}</Alert>
      </section>
    </template>
  </div>
</template>

<style scoped>
@keyframes pow-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
.pow-indeterminate {
  animation: pow-slide 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
</style>

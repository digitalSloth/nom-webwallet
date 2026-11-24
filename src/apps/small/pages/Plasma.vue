<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { QSR_ZTS } from 'znn-typescript-sdk'
import type { FusionEntry } from 'znn-typescript-sdk'
import { useAccount, useNetwork, usePlasma, usePlasmaBot, useWallet } from '@/core'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { MIN_FUSE_AMOUNT_QSR } from '@/config'
import {
  Alert,
  Badge,
  Button,
  Input,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'nom-ui'
import { WalletIcon, ZapIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import { trackSend } from '@/shared/lib/unresolved-send'
import { formatAmount, isValidAddress } from '@/shared/lib/amount'
import { shortAddress } from '@/shared/lib/format'
import {
  canCancelFusion,
  lowestAvailableTier,
  parseFuseAmount,
  plasmaBotErrorText,
  plasmaPercent,
} from '@/shared/lib/plasma'
import { injectSmallHost } from '@/apps/small/host'

const BOT_POLL_MS = 2_000

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const network = useNetwork()
const plasma = usePlasma()
const plasmaBot = usePlasmaBot()

const host = injectSmallHost()

const accountLabel = computed(
  () => wallet.activeWallet.value?.accounts.find((a) => a.address === active())?.label ?? 'Account'
)

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

function goBack(): void {
  if (router.options.history.state.back) router.back()
  else void router.push('/')
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

const activeTab = ref<'bot' | 'fuse'>('bot')

// Get free plasma
const tier = computed(() => lowestAvailableTier(plasmaBot.stats.value, plasmaBot.statsStatus.value))
const waiting = ref(false)
const place = host.placeLabel
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
const editingBeneficiary = ref(false)
const beneficiaryInput = ref('')
const fuseError = ref<string | null>(null)
const unknownOutcome = ref(false)
trackSend(submitting, unknownOutcome)

const qsrRaw = computed(() => {
  const row = account.balances.value.find((b) => b.tokenStandard === QSR_ZTS.toString())
  return row ? BigInt(row.balance) : 0n
})
const fuse = computed(() => parseFuseAmount(amount.value, qsrRaw.value))

const beneficiaryTrimmed = computed(() => beneficiaryInput.value.trim())
const beneficiaryError = computed(() =>
  editingBeneficiary.value &&
  beneficiaryTrimmed.value !== '' &&
  !isValidAddress(beneficiaryTrimmed.value)
    ? 'Enter a valid z1 address'
    : null
)
const beneficiary = computed(() => (editingBeneficiary.value ? beneficiaryTrimmed.value : active()))
const beneficiaryValid = computed(
  () => !editingBeneficiary.value || isValidAddress(beneficiaryTrimmed.value)
)

function toggleBeneficiary(): void {
  if (editingBeneficiary.value) beneficiaryInput.value = ''
  editingBeneficiary.value = !editingBeneficiary.value
}

async function fuseQsr(): Promise<void> {
  const raw = fuse.value.raw
  const activeWallet = wallet.activeWallet.value
  const address = active()
  const target = beneficiary.value
  if (raw === null || !beneficiaryValid.value || !activeWallet || !address || !target) return
  if (!wallet.isActiveWalletUnlocked.value) {
    host.requestUnlock()
    return
  }
  if (submitting.value) return
  fuseError.value = null
  submitting.value = true
  try {
    const block = await plasma.fuseQsr(activeWallet, address, target, raw, {
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
    if (fuseError.value === SEND_TIMEOUT_MESSAGE) unknownOutcome.value = true
  } finally {
    submitting.value = false
  }
}

// Active fusions
const cancelError = ref<string | null>(null)

async function cancelFusion(entry: FusionEntry): Promise<void> {
  const activeWallet = wallet.activeWallet.value
  const address = active()
  if (!activeWallet || !address) return
  if (!wallet.isActiveWalletUnlocked.value) {
    host.requestUnlock()
    return
  }
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
  <div class="flex h-full flex-col">
    <PageHeader title="Plasma" :back-disabled="busy" @back="goBack">
      <span v-if="active()" class="font-mono text-xs text-muted-foreground">
        {{ accountLabel }} · {{ shortAddress(active()!) }}
      </span>
    </PageHeader>

    <div v-if="!active()" class="flex-1 py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div v-else class="flex-1 space-y-4 overflow-y-auto p-4">
      <section aria-label="Plasma level" class="space-y-2 rounded-lg border bg-card px-3 py-3">
        <div class="flex items-center justify-between">
          <span class="text-ledger text-muted-foreground">Plasma level</span>
          <span :class="['text-sm font-semibold', level.class]">{{ level.label }}</span>
        </div>
        <div
          class="h-2 overflow-hidden rounded-full bg-muted"
          role="img"
          :aria-label="`Plasma ${percent} percent`"
        >
          <div class="h-full rounded-full bg-plasma" :style="{ width: `${percent}%` }" />
        </div>
        <p class="text-xs text-muted-foreground">{{ level.hint }}</p>
      </section>

      <Tabs v-model="activeTab">
        <TabsList variant="underline">
          <TabsTrigger variant="underline" value="bot">Get free plasma</TabsTrigger>
          <TabsTrigger variant="underline" value="fuse">Fuse QSR</TabsTrigger>
        </TabsList>

        <TabsContent value="bot" class="space-y-3 pt-3">
          <p class="text-sm text-muted-foreground">
            No QSR?
            <a href="https://plazma.bot" target="_blank" rel="noopener noreferrer" class="text-info"
              >plazma.bot</a
            >
            fuses plasma to your current account for free.
          </p>
          <p
            v-if="statusLine"
            :class="['text-xs', statusLine.warning ? 'text-warning' : 'text-muted-foreground']"
          >
            {{ statusLine.text }}
          </p>
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
              Shows here once the next momentum confirms it. You can close the {{ place }}.
            </span>
          </div>
          <Button
            v-else
            class="w-full"
            size="lg"
            :disabled="!active() || tier === null || plasmaBot.isFusing.value"
            @click="requestBot"
          >
            <template v-if="plasmaBot.isFusing.value"><Spinner /> Requesting…</template>
            <template v-else><ZapIcon /> Get free plasma</template>
          </Button>
          <p v-if="!waiting" class="text-xs text-muted-foreground">
            Sent to {{ accountLabel }}. It arrives within a few momentums.
          </p>
          <p v-if="botArrived" class="text-sm text-success">Plasma arrived.</p>
          <Alert v-if="botError" variant="destructive" class="text-sm">{{ botError }}</Alert>
        </TabsContent>

        <TabsContent value="fuse" class="space-y-3 pt-3">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <label for="fuse-amount" class="text-ledger text-muted-foreground">
                Amount (QSR)
              </label>
              <span class="text-xs text-muted-foreground">
                Min <span class="font-mono">{{ MIN_FUSE_AMOUNT_QSR }}</span> · Available
                <span class="font-mono">{{ formatAmount(qsrRaw, 8) }}</span>
              </span>
            </div>
            <Input id="fuse-amount" v-model="amount" numeric placeholder="10" autocomplete="off" />
            <p v-if="fuse.error" class="text-xs text-destructive">{{ fuse.error }}</p>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between text-sm">
              <span class="text-ledger text-muted-foreground">For</span>
              <span class="flex items-center gap-2">
                <span v-if="!editingBeneficiary">
                  This account
                  <span class="font-mono text-muted-foreground">{{ shortAddress(active()!) }}</span>
                </span>
                <button
                  type="button"
                  class="text-xs font-medium text-info"
                  @click="toggleBeneficiary"
                >
                  {{ editingBeneficiary ? 'This account' : 'Change' }}
                </button>
              </span>
            </div>
            <template v-if="editingBeneficiary">
              <Input
                v-model="beneficiaryInput"
                placeholder="z1…"
                autocomplete="off"
                spellcheck="false"
                class="font-mono"
                aria-label="Beneficiary address"
              />
              <p v-if="beneficiaryError" class="text-xs text-destructive">
                {{ beneficiaryError }}
              </p>
            </template>
          </div>

          <Alert v-if="fuseError" variant="destructive" class="text-sm">{{ fuseError }}</Alert>
          <Button
            v-if="unknownOutcome"
            class="w-full"
            size="lg"
            @click="router.replace({ name: 'home', query: { tab: 'activity' } })"
          >
            Check activity
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
          <p class="text-xs text-muted-foreground">
            Fused QSR stays yours. Cancel the fusion later to get it back.
          </p>
        </TabsContent>
      </Tabs>

      <section class="space-y-2">
        <h2 class="text-ledger text-muted-foreground">Active fusions</h2>
        <div v-if="plasma.isLoading.value && fusions.length === 0" class="flex justify-center py-4">
          <Spinner />
        </div>
        <p v-else-if="fusions.length === 0" class="text-sm text-muted-foreground">
          No active fusions
        </p>
        <ul v-else class="divide-y rounded-lg border">
          <li
            v-for="entry in fusions"
            :key="entry.id.toString()"
            class="flex items-center gap-3 px-3 py-2.5"
          >
            <div class="min-w-0 flex-1">
              <div class="font-mono text-sm font-semibold">
                {{ formatAmount(BigInt(entry.qsrAmount.toString()), 8) }} QSR
              </div>
              <div class="font-mono text-xs text-muted-foreground">
                → {{ shortAddress(entry.beneficiary.toString()) }}
              </div>
            </div>
            <Button
              v-if="canCancelFusion(entry, network.currentMomentum.value)"
              variant="outline"
              size="sm"
              :disabled="busy"
              @click="cancelFusion(entry)"
            >
              {{
                plasma.cancelingFusionId.value === entry.id.toString() ? 'Cancelling…' : 'Cancel'
              }}
            </Button>
            <Badge v-else variant="secondary">Locked</Badge>
          </li>
        </ul>
        <Alert v-if="cancelError" variant="destructive" class="text-sm">{{ cancelError }}</Alert>
      </section>
    </div>
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

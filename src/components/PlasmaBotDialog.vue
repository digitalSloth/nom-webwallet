<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {PLASMA_BOT_TIERS, PlasmaBotError, type PlasmaBotTierKey, useAccount, usePlasmaBot} from '@/core'
import {Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input,} from 'nom-ui'

interface PlasmaBotDialogProps {
  open: boolean
  activeAccountAddress: string | null
}

const props = defineProps<PlasmaBotDialogProps>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  showToast: [message: string, type: 'success' | 'error' | 'info' | 'warning']
  fused: []
}>()

const plasmaBot = usePlasmaBot()
const account = useAccount(() => props.activeAccountAddress)

const selectedTier = ref<PlasmaBotTierKey>('low')
const botTiers = PLASMA_BOT_TIERS

// Refresh availability whenever the dialog opens (fail-open if unreachable).
// Reset to the lowest tier first; the stats watch bumps it up only if Low is unfundable.
watch(
  () => props.open,
  (open) => {
    if (open) {
      selectedTier.value = 'low'
      void plasmaBot.loadStats()
    }
  }
)

const availableTiers = computed(() => plasmaBot.stats.value?.availableTiers ?? [])
const hasNoFundableTiers = computed(
  () => plasmaBot.statsStatus.value === 'online' && availableTiers.value.length === 0
)

// Fail-open: only restrict tiers when we have a confirmed 'online' status.
function isTierAvailable(key: PlasmaBotTierKey): boolean {
  if (plasmaBot.statsStatus.value !== 'online') return true
  return availableTiers.value.includes(key)
}

const statusLine = computed<{text: string; warning: boolean} | null>(() => {
  switch (plasmaBot.statsStatus.value) {
    case 'checking':
      return {text: 'Checking plazma.bot…', warning: false}
    case 'online':
      return availableTiers.value.length === 0
        ? {text: 'plazma.bot is low on QSR right now.', warning: true}
        : {
            text: `plazma.bot online · ${plasmaBot.stats.value?.qsrAvailable ?? 0} QSR available`,
            warning: false
          }
    case 'unreachable':
      return {text: 'Couldn’t reach plazma.bot — you can still try.', warning: false}
    default:
      return null
  }
})

// When availability loads, move selection off an unfundable tier to the lowest available.
watch(
  () => plasmaBot.stats.value,
  (s) => {
    if (
      plasmaBot.statsStatus.value === 'online' &&
      s &&
      !s.availableTiers.includes(selectedTier.value)
    ) {
      const firstAvailable = botTiers.find((t) => s.availableTiers.includes(t.key))
      if (firstAvailable) selectedTier.value = firstAvailable.key
    }
  }
)

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value)
})

function botErrorToToast(err: PlasmaBotError): {message: string; type: 'error' | 'warning'} {
  switch (err.code) {
    case 'ADDRESS_UNAVAILABLE':
      return {
        message: 'You already have an active plazma.bot fusion for this account.',
        type: 'warning'
      }
    case 'RATE_LIMITED':
      return {message: 'plazma.bot rate limit reached — please try again later.', type: 'warning'}
    case 'INSUFFICIENT_BALANCE':
      return {
        message: 'plazma.bot is low on QSR right now. Try a lower tier or try again later.',
        type: 'warning'
      }
    case 'VALIDATION_FAILED':
      return {message: 'Could not request plasma: invalid request.', type: 'error'}
    default:
      return {message: 'Failed to get plasma from plazma.bot. Please try again.', type: 'error'}
  }
}

const POLL_INTERVAL_MS = 2000

const isWaitingForPlasma = ref(false)

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Poll on-chain plasma until it rises above the pre-fuse level (the bot's fusion
// has confirmed). There is no timeout: only a confirmed fusion closes the dialog.
// The 60s countdown ring is a visual estimate, NOT a deadline. The loop also
// stops if the user closes the dialog manually (props.open flips false).
async function waitForPlasma(startingPlasma: number): Promise<boolean> {
  while (isWaitingForPlasma.value && props.open) {
    await delay(POLL_INTERVAL_MS)
    await account.loadPlasmaInfo()
    if (account.currentPlasma.value > startingPlasma) return true
  }
  return false
}

async function handleRequest() {
  if (!props.activeAccountAddress) return
  const startingPlasma = account.currentPlasma.value
  try {
    await plasmaBot.fuse(props.activeAccountAddress, selectedTier.value)
    // The bot accepted the request; keep the dialog open and poll until the
    // plasma actually confirms on-chain — polling, not the timer, closes it.
    isWaitingForPlasma.value = true
    const arrived = await waitForPlasma(startingPlasma)
    if (arrived) {
      emit('fused')
      emit('showToast', 'plazma.bot fused QSR to your account!', 'success')
      emit('update:open', false)
    }
  } catch (err) {
    if (err instanceof PlasmaBotError) {
      const toast = botErrorToToast(err)
      emit('showToast', toast.message, toast.type)
    } else {
      emit('showToast', 'Failed to get plasma from plazma.bot. Please try again.', 'error')
    }
    // dialog stays open on error so the user can retry
  } finally {
    isWaitingForPlasma.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Get free plasma from plazma.bot</DialogTitle>
        <DialogDescription>
          <a
              href="https://plazma.bot"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-2 hover:text-foreground"
          >plazma.bot</a>
          fuses QSR to your account for free. No QSR required — just choose a tier and go.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
        <div
            v-if="statusLine"
            class="text-xs"
            :class="statusLine.warning ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'"
        >
          {{ statusLine.text }}
        </div>

        <!-- Beneficiary (locked to current account) -->
        <div class="space-y-2">
          <Input :model-value="activeAccountAddress ?? ''" disabled readonly />
          <div class="text-xs text-muted-foreground">Sent to your current account.</div>
        </div>

        <!-- Tier selector -->
        <div class="grid grid-cols-3 gap-2">
          <Button
              v-for="tier in botTiers"
              :key="tier.key"
              type="button"
              :variant="selectedTier === tier.key ? 'default' : 'outline'"
              :disabled="plasmaBot.isFusing.value || isWaitingForPlasma || !isTierAvailable(tier.key)"
              @click="selectedTier = tier.key"
          >
            {{ tier.label }}
          </Button>
        </div>
      </div>

      <DialogFooter>
        <!-- While the fusion confirms, swap the button for a depleting countdown ring -->
        <div v-if="isWaitingForPlasma" class="flex w-full flex-col items-center gap-3 py-2">
          <svg viewBox="0 0 52 52" class="h-14 w-14 -rotate-90">
            <circle
                cx="26"
                cy="26"
                r="22"
                fill="none"
                stroke-width="4"
                class="stroke-muted-foreground/20"
            />
            <circle
                cx="26"
                cy="26"
                r="22"
                fill="none"
                stroke-width="4"
                stroke-linecap="round"
                class="plasma-countdown stroke-primary"
            />
          </svg>
          <div class="text-sm text-muted-foreground">Waiting for plasma to arrive…</div>
        </div>
        <Button
            v-else
            class="w-full"
            :disabled="plasmaBot.isFusing.value || !activeAccountAddress || hasNoFundableTiers"
            @click="handleRequest"
        >
          {{ plasmaBot.isFusing.value ? 'Requesting…' : 'Get Plasma' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* Depleting countdown ring: full → empty over 60s — a visual estimate only,
   not a deadline (polling keeps running past it until the fusion confirms).
   r=22 → circumference = 2πr ≈ 138.23. No numbers, just the arc receding. */
.plasma-countdown {
  stroke-dasharray: 138.23;
  animation: plasma-countdown 60s linear forwards;
}

@keyframes plasma-countdown {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 138.23;
  }
}
</style>

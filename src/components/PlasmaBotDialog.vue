<script setup lang="ts">
import {computed, ref} from 'vue'
import {PlasmaBotError, type PlasmaBotTierKey, usePlasmaBot} from '@/core'
import {PLASMA_BOT_TIERS} from '@/config'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from '@nom/ui'

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

const selectedTier = ref<PlasmaBotTierKey>('low')
const botTiers = PLASMA_BOT_TIERS

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

async function handleRequest() {
  if (!props.activeAccountAddress) return
  const tier = botTiers.find((t) => t.key === selectedTier.value)
  const qsr = tier ? tier.qsr : 0
  try {
    await plasmaBot.fuse(props.activeAccountAddress, selectedTier.value)
    emit('showToast', `plazma.bot fused ${qsr} QSR to your account!`, 'success')
    emit('fused')
    emit('update:open', false)
  } catch (err) {
    if (err instanceof PlasmaBotError) {
      const toast = botErrorToToast(err)
      emit('showToast', toast.message, toast.type)
    } else {
      emit('showToast', 'Failed to get plasma from plazma.bot. Please try again.', 'error')
    }
    // dialog stays open on error so the user can retry
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Get free plasma from plazma.bot</DialogTitle>
        <DialogDescription>
          plazma.bot fuses QSR to your account for free. No QSR or wallet unlock required.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4">
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
              :disabled="plasmaBot.isFusing.value"
              @click="selectedTier = tier.key"
          >
            {{ tier.label }} · {{ tier.qsr }}
          </Button>
        </div>
      </div>

      <DialogFooter>
        <Button
            :disabled="plasmaBot.isFusing.value || !activeAccountAddress"
            @click="handleRequest"
        >
          {{ plasmaBot.isFusing.value ? 'Requesting…' : 'Get Plasma' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

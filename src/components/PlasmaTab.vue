<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {
  PlasmaBotError,
  type PlasmaBotTierKey,
  useAccount,
  useNetwork,
  usePlasma,
  usePlasmaBot,
  useWallet,
} from '@/core'
import {MIN_FUSE_AMOUNT_QSR, PLASMA_BOT_TIERS} from '@/config'
import {extractNumberDecimals} from 'znn-typescript-sdk'
import FusionList from './FusionList.vue'
import {Alert, AlertDescription, Button, Input} from '@nom/ui'

interface PlasmaTabProps {
  activeAccountAddress: string | null
  isActive?: boolean
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<PlasmaTabProps>(), {
  isActive: false,
  isWalletLocked: false
})

const emit = defineEmits<{
  showToast: [message: string, type: 'success' | 'error' | 'info' | 'warning']
  plasmaUpdated: []
}>()

const plasma = usePlasma()
const plasmaBot = usePlasmaBot()

// plasma.bot panel state
const selectedBotTier = ref<PlasmaBotTierKey>('low')
const botTiers = PLASMA_BOT_TIERS
const network = useNetwork()
const account = useAccount(() => props.activeAccountAddress)
const wallet = useWallet()

// Form state
const beneficiaryAddress = ref('')
const fuseAmount = ref('')
const formError = ref<string | null>(null)

// Computed
const currentMomentum = computed(() => network.currentMomentum.value)

const qsrBalance = computed(() => {
  return account.qsrBalance.value
})

const minFuseAmount = MIN_FUSE_AMOUNT_QSR

// Load on mount if active and account exists
onMounted(async () => {
  if (props.isActive && props.activeAccountAddress) {
    await loadData()
  }
})

// Watch for when the tab becomes active
watch(() => props.isActive, async (isActive) => {
  if (isActive && props.activeAccountAddress) {
    await loadData()
  }
})

// Watch for account changes
watch(() => props.activeAccountAddress, async (newAddress) => {
  if (newAddress && props.isActive) {
    await loadData()
    // Set beneficiary to current account by default
    beneficiaryAddress.value = newAddress
  }
})

async function loadData() {
  if (!props.activeAccountAddress) {
    plasma.fusionEntries.value = []
    return
  }

  // Set beneficiary to current account if not set
  if (!beneficiaryAddress.value) {
    beneficiaryAddress.value = props.activeAccountAddress
  }

  await Promise.all([
    plasma.loadFusionEntries(props.activeAccountAddress),
    network.loadFrontierMomentum(),
    account.loadBalances()
  ])
}

async function handleFuse() {
  if (!props.activeAccountAddress) return

  formError.value = null

  // Validate inputs
  if (!beneficiaryAddress.value) {
    formError.value = 'Please enter a beneficiary address'
    return
  }

  if (!beneficiaryAddress.value.startsWith('z1')) {
    formError.value = 'Invalid beneficiary address'
    return
  }

  if (!fuseAmount.value || parseFloat(fuseAmount.value) <= 0) {
    formError.value = 'Please enter a valid amount'
    return
  }

  const amount = parseFloat(fuseAmount.value)
  if (amount < minFuseAmount) {
    formError.value = `Minimum fuse amount is ${minFuseAmount} QSR`
    return
  }

  // Check balance
  const balanceNum = parseFloat(qsrBalance.value)
  if (amount > balanceNum) {
    formError.value = 'Insufficient QSR balance'
    return
  }

  // Check if wallet is unlocked
  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    emit('showToast', 'Please unlock your wallet first', 'warning')
    return
  }

  try {
    const amountInSmallestUnit = extractNumberDecimals(amount, 8)

    await plasma.fuseQsr(
      activeWallet,
      props.activeAccountAddress,
      beneficiaryAddress.value,
      amountInSmallestUnit
    )

    // Clear form
    fuseAmount.value = ''

    // Reload data
    await loadData()

    // Emit events
    emit('plasmaUpdated')
    emit('showToast', `Successfully fused ${amount} QSR!`, 'success')
  } catch (error) {
    console.error('Failed to fuse QSR:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    formError.value = errorMessage
    emit('showToast', `Failed to fuse QSR: ${errorMessage}`, 'error')
  }
}

function botErrorToToast(err: PlasmaBotError): {message: string; type: 'error' | 'warning'} {
  switch (err.code) {
    case 'ADDRESS_UNAVAILABLE':
      return {
        message: 'You already have an active plasma.bot fusion for this account.',
        type: 'warning'
      }
    case 'RATE_LIMITED':
      return {message: 'plasma.bot rate limit reached — please try again later.', type: 'warning'}
    case 'INSUFFICIENT_BALANCE':
      return {
        message: 'plasma.bot is low on QSR right now. Try a lower tier or try again later.',
        type: 'warning'
      }
    case 'VALIDATION_FAILED':
      return {message: 'Could not request plasma: invalid request.', type: 'error'}
    default:
      return {message: 'Failed to get plasma from plasma.bot. Please try again.', type: 'error'}
  }
}

async function handleBotFuse() {
  if (!props.activeAccountAddress) return

  const tier = botTiers.find((t) => t.key === selectedBotTier.value)
  const qsr = tier ? tier.qsr : 0

  try {
    await plasmaBot.fuse(props.activeAccountAddress, selectedBotTier.value)

    // Bot signs and pays; refresh balances so the new plasma shows up.
    await loadData()

    emit('plasmaUpdated')
    emit('showToast', `plasma.bot fused ${qsr} QSR to your account!`, 'success')
  } catch (err) {
    if (err instanceof PlasmaBotError) {
      const toast = botErrorToToast(err)
      emit('showToast', toast.message, toast.type)
    } else {
      emit('showToast', 'Failed to get plasma from plasma.bot. Please try again.', 'error')
    }
  }
}

async function handleCancel(fusionId: string) {
  if (!props.activeAccountAddress) return

  // Check if wallet is unlocked
  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    emit('showToast', 'Please unlock your wallet first', 'warning')
    return
  }

  try {
    await plasma.cancelFusion(activeWallet, props.activeAccountAddress, fusionId)

    // Reload data
    await loadData()

    // Emit events
    emit('plasmaUpdated')
    emit('showToast', 'Successfully canceled fusion!', 'success')
  } catch (error) {
    console.error('Failed to cancel fusion:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    emit('showToast', `Failed to cancel fusion: ${errorMessage}`, 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="plasma.isLoading.value && plasma.fusionEntries.value.length === 0" class="text-center py-8 text-muted-foreground">
      Loading plasma data...
    </div>
    <div v-else class="space-y-6">

      <!-- Plasma acquisition: self-fuse (left) + plasma.bot faucet (right) -->
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Left: fuse from your own wallet -->
        <section class="space-y-4">
          <div class="font-semibold">Fuse from your wallet</div>
          <!-- Beneficiary Address -->
          <div class="space-y-2">
            <label for="fuse-beneficiary" class="text-sm font-medium">Beneficiary Address</label>
            <Input
                id="fuse-beneficiary"
                v-model="beneficiaryAddress"
                placeholder="z1..."
                :disabled="plasma.isFusing.value"
            />
            <div class="text-xs text-muted-foreground">
              The address that will receive the plasma (defaults to your current account)
            </div>
          </div>

          <!-- Amount -->
          <div class="space-y-2">
            <label for="fuse-amount" class="text-sm font-medium">Amount (QSR)</label>
            <Input
                id="fuse-amount"
                v-model="fuseAmount"
                type="number"
                step="any"
                :min="minFuseAmount"
                placeholder="10.00"
                :disabled="plasma.isFusing.value"
            />
            <div class="text-xs text-muted-foreground">
              Available: {{ qsrBalance }} QSR | Minimum: {{ minFuseAmount }} QSR
            </div>
          </div>

          <!-- Error Message -->
          <Alert v-if="formError" variant="destructive">
            <AlertDescription>{{ formError }}</AlertDescription>
          </Alert>

          <!-- Fuse Button -->
          <Button
              @click="handleFuse"
              class="w-full"
              :disabled="plasma.isFusing.value || isWalletLocked"
          >
            {{ plasma.isFusing.value ? 'Fusing...' : 'Fuse Plasma' }}
          </Button>
        </section>

        <!-- Right: free plasma from plasma.bot -->
        <section class="space-y-4">
          <div class="font-semibold">Get free plasma from plasma.bot</div>
          <div class="text-xs text-muted-foreground">
            plasma.bot fuses QSR to your current account for free. No QSR or wallet
            unlock required.
          </div>

          <!-- Beneficiary (locked to current account) -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Beneficiary Address</label>
            <Input :model-value="activeAccountAddress ?? ''" disabled readonly />
            <div class="text-xs text-muted-foreground">
              Free plasma is always sent to your current account.
            </div>
          </div>

          <!-- Tier selector -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Tier</label>
            <div class="grid grid-cols-3 gap-2">
              <Button
                  v-for="tier in botTiers"
                  :key="tier.key"
                  type="button"
                  :variant="selectedBotTier === tier.key ? 'default' : 'outline'"
                  :disabled="plasmaBot.isFusing.value"
                  @click="selectedBotTier = tier.key"
              >
                {{ tier.label }} · {{ tier.qsr }}
              </Button>
            </div>
            <div class="text-xs text-muted-foreground">QSR fused by the bot for the selected tier.</div>
          </div>

          <!-- Get Plasma Button -->
          <Button
              class="w-full"
              :disabled="plasmaBot.isFusing.value || !activeAccountAddress"
              @click="handleBotFuse"
          >
            {{ plasmaBot.isFusing.value ? 'Requesting…' : 'Get Plasma' }}
          </Button>
        </section>
      </div>

      <!-- Active Fusions List -->
      <div v-if="plasma.fusionEntries.value.length > 0">
        <div class="font-semibold text-lg mb-3">Active Plasma Fusions</div>
        <FusionList
          :fusions="plasma.fusionEntries.value"
          :is-canceling="plasma.isCanceling.value"
          :canceling-fusion-id="plasma.cancelingFusionId.value"
          :current-momentum="currentMomentum"
          :is-wallet-locked="isWalletLocked"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useAccount, useNetwork, usePlasma, useWallet} from '@/core'
import {MIN_FUSE_AMOUNT_QSR} from '@/config'
import {extractNumberDecimals} from 'znn-typescript-sdk'
import FusionList from './FusionList.vue'
import PlasmaBotDialog from './PlasmaBotDialog.vue'
import {Alert, AlertDescription, Button, Input, Spinner} from 'nom-ui'

interface PlasmaTabProps {
  activeAccountAddress: string | null
  isActive?: boolean
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<PlasmaTabProps>(), {
  isActive: false,
  isWalletLocked: false,
})

const emit = defineEmits<{
  showToast: [message: string, type: 'success' | 'error' | 'info' | 'warning']
  plasmaUpdated: []
}>()

const plasma = usePlasma()
const network = useNetwork()
const account = useAccount(() => props.activeAccountAddress)
const wallet = useWallet()

// Form state
const beneficiaryAddress = ref('')
const fuseAmount = ref('')
const formError = ref<string | null>(null)
const botDialogOpen = ref(false)

// Computed
const currentMomentum = computed(() => network.currentMomentum.value)

const qsrBalance = computed(() => {
  return account.qsrBalance.value
})

const minFuseAmount = MIN_FUSE_AMOUNT_QSR

const showBotPrompt = computed(() => parseFloat(qsrBalance.value) < minFuseAmount)

// Load on mount if active and account exists
onMounted(async () => {
  if (props.isActive && props.activeAccountAddress) {
    await loadData()
  }
})

// Watch for when the tab becomes active
watch(
  () => props.isActive,
  async (isActive) => {
    if (isActive && props.activeAccountAddress) {
      await loadData()
    }
  }
)

// Watch for account changes
watch(
  () => props.activeAccountAddress,
  async (newAddress) => {
    if (newAddress && props.isActive) {
      await loadData()
      // Set beneficiary to current account by default
      beneficiaryAddress.value = newAddress
    }
  }
)

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
    account.loadBalances(),
    account.loadPlasmaInfo(),
  ])
}

async function onBotFused() {
  await loadData()
  emit('plasmaUpdated')
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
    <div
      v-if="plasma.isLoading.value && plasma.fusionEntries.value.length === 0"
      class="py-8 text-center text-muted-foreground"
    >
      <Spinner class="mx-auto" />
    </div>
    <div v-else class="space-y-6">
      <!-- plazma.bot prompt: only when the account can neither transact nor self-fuse -->
      <div
        v-if="showBotPrompt"
        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4"
      >
        <div class="text-sm">
          <div class="font-medium">No QSR for plasma?</div>
          <div class="text-muted-foreground">
            Get some plasma from
            <a
              href="https://plazma.bot"
              target="_blank"
              rel="noopener noreferrer"
              class="underline underline-offset-2 hover:text-foreground"
              >plazma.bot</a
            >
          </div>
        </div>
        <Button type="button" @click="botDialogOpen = true">Get free plasma</Button>
      </div>

      <!-- Fuse from your own wallet -->
      <div class="space-y-4">
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
          <span v-if="plasma.isFusing.value" class="flex items-center gap-2"
            ><Spinner class="size-4" />Fusing...</span
          >
          <span v-else>Fuse Plasma</span>
        </Button>
      </div>

      <PlasmaBotDialog
        v-model:open="botDialogOpen"
        :active-account-address="activeAccountAddress"
        @show-toast="(m, t) => emit('showToast', m, t)"
        @fused="onBotFused"
      />

      <!-- Active Fusions List -->
      <div v-if="plasma.fusionEntries.value.length > 0">
        <div class="mb-3 text-lg font-semibold">Active Plasma Fusions</div>
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

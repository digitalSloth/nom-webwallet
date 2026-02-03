<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useAccount, useStake, useWallet} from '@/core'
import {MIN_STAKE_AMOUNT_ZNN, STAKE_DURATION_OPTIONS} from '@/config'
import {extractNumberDecimals} from 'znn-typescript-sdk'
import StakeList from './StakeList.vue'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nom/ui'

interface StakeTabProps {
  activeAccountAddress: string | null
  isActive?: boolean
  isWalletLocked?: boolean
}

const props = withDefaults(defineProps<StakeTabProps>(), {
  isActive: false,
  isWalletLocked: false
})

const emit = defineEmits<{
  showToast: [message: string, type: 'success' | 'error' | 'info' | 'warning']
  stakeUpdated: []
}>()

const stake = useStake()
const account = useAccount(() => props.activeAccountAddress)
const wallet = useWallet()

// Form state
const stakeAmount = ref('')
const stakeDuration = ref<number>(STAKE_DURATION_OPTIONS[0].value)
const formError = ref<string | null>(null)

// Computed
const znnBalance = computed(() => {
  return account.znnBalance.value
})

const minStakeAmount = MIN_STAKE_AMOUNT_ZNN

const durationOptions = STAKE_DURATION_OPTIONS

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
  }
})

async function loadData() {
  if (!props.activeAccountAddress) {
    stake.stakeEntries.value = []
    return
  }

  await Promise.all([
    stake.loadStakeEntries(props.activeAccountAddress),
    account.loadBalances()
  ])
}

async function handleStake() {
  if (!props.activeAccountAddress) return

  formError.value = null

  // Validate inputs
  if (!stakeAmount.value || parseFloat(stakeAmount.value) <= 0) {
    formError.value = 'Please enter a valid amount'
    return
  }

  const amount = parseFloat(stakeAmount.value)
  if (amount < minStakeAmount) {
    formError.value = `Minimum stake amount is ${minStakeAmount} ZNN`
    return
  }

  // Check balance
  const balanceNum = parseFloat(znnBalance.value)
  if (amount > balanceNum) {
    formError.value = 'Insufficient ZNN balance'
    return
  }

  // Validate duration
  if (!stakeDuration.value) {
    formError.value = 'Please select a stake duration'
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
    const durationInSec = stakeDuration.value

    await stake.stakeZnn(
      activeWallet,
      props.activeAccountAddress,
      durationInSec,
      amountInSmallestUnit
    )

    // Clear form
    stakeAmount.value = ''

    // Reload data
    await loadData()

    // Emit events
    emit('stakeUpdated')
    emit('showToast', `Successfully staked ${amount} ZNN!`, 'success')
  } catch (error) {
    console.error('Failed to stake ZNN:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    formError.value = errorMessage
    emit('showToast', `Failed to stake ZNN: ${errorMessage}`, 'error')
  }
}

async function handleCancel(stakeId: string) {
  if (!props.activeAccountAddress) return

  // Check if wallet is unlocked
  const activeWallet = wallet.activeWallet.value
  if (!activeWallet || !wallet.isActiveWalletUnlocked.value) {
    emit('showToast', 'Please unlock your wallet first', 'warning')
    return
  }

  try {
    await stake.cancelStake(activeWallet, props.activeAccountAddress, stakeId)

    // Reload data
    await loadData()

    // Emit events
    emit('stakeUpdated')
    emit('showToast', 'Successfully canceled stake!', 'success')
  } catch (error) {
    console.error('Failed to cancel stake:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    emit('showToast', `Failed to cancel stake: ${errorMessage}`, 'error')
  }
}
</script>

<template>
  <div>
    <div v-if="stake.isLoading.value && stake.stakeEntries.value.length === 0" class="text-center py-8 text-muted-foreground">
      Loading stake data...
    </div>
    <div v-else class="space-y-6">
      <!-- Stake ZNN Form -->
      <div class="space-y-4">
        <!-- Amount -->
        <div class="space-y-2">
          <label for="stake-amount" class="text-sm font-medium">Amount (ZNN)</label>
          <Input
              id="stake-amount"
              v-model="stakeAmount"
              type="number"
              step="any"
              :min="minStakeAmount"
              placeholder="1.00"
              :disabled="stake.isStaking.value"
          />
          <div class="text-xs text-muted-foreground">
            Available: {{ znnBalance }} ZNN | Minimum: {{ minStakeAmount }} ZNN
          </div>
        </div>

        <!-- Duration -->
        <div class="space-y-2">
          <label for="stake-duration" class="text-sm font-medium">Stake Duration</label>
          <Select
              v-model="stakeDuration"
              :disabled="stake.isStaking.value"
          >
            <SelectTrigger id="stake-duration" class="w-full">
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                  v-for="option in durationOptions"
                  :key="option.value"
                  :value="option.value"
              >
                {{ option.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <div class="text-xs text-muted-foreground">
            Your ZNN will be locked for the selected duration
          </div>
        </div>

        <!-- Error Message -->
        <Alert v-if="formError" variant="destructive">
          <AlertDescription>{{ formError }}</AlertDescription>
        </Alert>

        <!-- Stake Button -->
        <Button
            @click="handleStake"
            class="w-full"
            :disabled="stake.isStaking.value || isWalletLocked"
        >
          {{ stake.isStaking.value ? 'Staking...' : 'Stake ZNN' }}
        </Button>
      </div>

      <!-- Active Stakes List -->
      <div v-if="stake.stakeEntries.value.length > 0">
        <div class="font-semibold text-lg mb-3">Active Stakes</div>
        <StakeList
          :stakes="stake.stakeEntries.value"
          :is-canceling="stake.isCanceling.value"
          :canceling-stake-id="stake.cancelingStakeId.value"
          :is-wallet-locked="isWalletLocked"
          @cancel="handleCancel"
        />
      </div>
    </div>
  </div>
</template>

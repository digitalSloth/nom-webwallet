<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {isGeneratingPow, useAccount, useTransaction, useWallet} from '@/core'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  useToast,
} from 'nom-ui'
import TokenList from '@/components/TokenList.vue'
import type {BalanceInfo} from '@/types'
import {addNumberDecimals, extractNumberDecimals} from 'znn-typescript-sdk'
import {ArrowLeftIcon, SendHorizontalIcon, TriangleAlertIcon} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()

// Use composables
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)
const transaction = useTransaction()

// Step management
const currentStep = ref<1 | 2>(1)

// Selected token and transaction details
const selectedToken = ref<BalanceInfo | null>(null)
const recipient = ref('')
const amount = ref('')

// UI state
const sendError = ref<string | null>(null)

// Toast
const toast = useToast()

const showPlasmaWarning = computed(() => account.plasmaLevel.value === 'low')

onMounted(async () => {
  await wallet.loadWalletData()
  if (wallet.activeAccountAddress.value) {
    await account.loadAccountData()
  }
})

// Watch for balances to load and check for pre-selected token
watch(
  () => account.balances.value,
  (balances) => {
    if (balances.length > 0 && !selectedToken.value) {
      const tokenStandard = route.query.token as string | undefined
      if (tokenStandard) {
        const token = balances.find((b) => b.tokenStandard === tokenStandard)
        if (token) {
          selectedToken.value = token
          currentStep.value = 2
        }
      }
    }
  },
  { immediate: true }
)

function handleTokenSelect(token: BalanceInfo) {
  selectedToken.value = token
  currentStep.value = 2
}

function goBack() {
  if (currentStep.value === 2) {
    currentStep.value = 1
    // Clear form when going back
    recipient.value = ''
    amount.value = ''
    sendError.value = null
  } else {
    router.push('/')
  }
}

function setMaxAmount() {
  if (!selectedToken.value) return

  amount.value = addNumberDecimals(selectedToken.value.balance, selectedToken.value.decimals)
}

async function handleSend() {
  if (
    !recipient.value ||
    !amount.value ||
    !selectedToken.value ||
    !wallet.activeAccountAddress.value
  ) {
    sendError.value = 'Please fill in all fields'
    return
  }

  // Validate recipient address
  if (!recipient.value.startsWith('z1')) {
    sendError.value = 'Invalid recipient address'
    return
  }

  // Get active wallet
  if (!wallet.activeWallet.value) {
    sendError.value = 'No active wallet found'
    return
  }

  // Convert amount using extractNumberDecimals
  const amountInSmallestUnit = extractNumberDecimals(
    parseFloat(amount.value),
    selectedToken.value.decimals
  )

  // Validate amount against balance
  const balanceBigInt = BigInt(selectedToken.value.balance)
  if (amountInSmallestUnit > balanceBigInt) {
    sendError.value = 'Insufficient balance'
    return
  }

  sendError.value = null

  try {
    await transaction.sendTransaction(
      wallet.activeWallet.value,
      wallet.activeAccountAddress.value,
      recipient.value,
      selectedToken.value.tokenStandard,
      amountInSmallestUnit
    )

    // Show success toast
    toast.show('Transaction sent successfully!', 'success')

    // Close overlay after short delay
    setTimeout(() => {
      router.push('/')
    }, 1500)
  } catch (error: any) {
    sendError.value = error?.message || 'Failed to send transaction'
    toast.show(error?.message || 'Failed to send transaction', 'error')
  }
}
</script>

<template>
  <!-- Full Page Overlay -->
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <!-- Header with Back Button -->
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button @click="goBack" variant="outline" title="Go back">
          <ArrowLeftIcon />
        </Button>
        <h1 class="text-2xl font-bold">
          Send {{ currentStep === 2 && selectedToken ? selectedToken.symbol : 'Tokens' }}
        </h1>
      </div>
    </div>

    <!-- Content -->
    <div class="container mx-auto max-w-4xl p-6">
      <!-- No Account Warning -->
      <Card v-if="!wallet.activeAccountAddress.value">
        <CardContent class="py-12 text-center text-muted-foreground">
          No active account. Please create or select a wallet first.
        </CardContent>
      </Card>

      <!-- Step 1: Token Selection -->
      <Card v-else-if="currentStep === 1">
        <CardHeader>
          <h3 class="text-xl font-semibold">Select Token to Send</h3>
          <p class="text-sm text-muted-foreground">Choose which token you want to send</p>
        </CardHeader>
        <CardContent>
          <TokenList
            v-if="account.balances.value.length > 0"
            :tokens="account.balances.value"
            :searchable="true"
            :selectable="true"
            @select="handleTokenSelect"
          />

          <div v-else class="py-12 text-center text-muted-foreground">
            No tokens available to send
          </div>
        </CardContent>
      </Card>

      <!-- Step 2: Transaction Details -->
      <div v-else-if="currentStep === 2 && selectedToken" class="space-y-6">
        <!-- Token Info -->
        <Item variant="muted" class="border-border">
          <ItemContent>
            <ItemTitle>{{ selectedToken.symbol || 'Unknown' }}</ItemTitle>
            <ItemDescription>{{ selectedToken.name }}</ItemDescription>
          </ItemContent>
          <ItemContent class="text-right">
            <ItemDescription>Available</ItemDescription>
            <ItemTitle class="font-mono">
              {{ addNumberDecimals(selectedToken.balance, selectedToken.decimals) }}
            </ItemTitle>
          </ItemContent>
        </Item>

        <!-- Transaction Form -->
        <Card>
          <CardHeader>
            <h3 class="text-xl font-semibold">Transaction Details</h3>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <!-- Recipient Address -->
              <Field>
                <FieldLabel for="recipient">Recipient Address</FieldLabel>
                <Input
                  id="recipient"
                  v-model="recipient"
                  placeholder="z1..."
                  :disabled="transaction.isSending.value"
                  class="font-mono"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                />
              </Field>

              <!-- Amount -->
              <Field>
                <FieldLabel for="amount">Amount</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="amount"
                    v-model="amount"
                    type="text"
                    step="any"
                    placeholder="0.00"
                    :disabled="transaction.isSending.value"
                    class="font-mono"
                    autocomplete="off"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      type="button"
                      variant="ghost"
                      size="xs"
                      @click="setMaxAmount"
                      :disabled="transaction.isSending.value"
                    >
                      MAX
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  Available: {{ addNumberDecimals(selectedToken.balance, selectedToken.decimals) }}
                  {{ selectedToken.symbol }}
                </FieldDescription>
              </Field>

              <!-- Plasma Warning -->
              <Alert v-if="showPlasmaWarning" variant="info">
                <TriangleAlertIcon class="h-4 w-4" />
                <AlertTitle>Low Plasma Detected</AlertTitle>
                <AlertDescription>
                  Proof of Work will be generated for this transaction. This may take longer.
                </AlertDescription>
              </Alert>

              <!-- Error Message -->
              <Alert v-if="sendError" variant="destructive">
                <AlertDescription>{{ sendError }}</AlertDescription>
              </Alert>

              <!-- Send Button -->
              <Button
                @click="handleSend"
                class="w-full"
                size="lg"
                :disabled="transaction.isSending.value"
              >
                <span
                  v-if="!transaction.isSending.value"
                  class="flex items-center justify-center gap-2"
                >
                  Send
                  <SendHorizontalIcon class="inline" />
                </span>
                <span v-else class="flex items-center justify-center gap-2">
                  <svg
                    class="h-4 w-4 animate-spin"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  <span v-if="isGeneratingPow">Generating plasma...</span>
                  <span v-else>Sending...</span>
                </span>
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

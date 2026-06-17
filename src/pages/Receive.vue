<script setup lang="ts">
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {formatDate, useAccount, useTransaction, useWallet} from '@/core'
import {
  Address,
  Alert,
  AlertDescription,
  Amount,
  Button,
  Card,
  CardContent,
  CardHeader,
  CopyButton,
  Heading,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Skeleton,
  Spinner,
  TxDirection,
  useToast,
} from 'nom-ui'
import type {AccountBlock} from 'znn-typescript-sdk'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {ArrowDownCircleIcon, ArrowLeftIcon, WalletIcon} from 'lucide-vue-next'

const router = useRouter()

// Use composables
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)
const transaction = useTransaction()

// UI state
const unreceivedBlocks = ref<AccountBlock[]>([])
const isLoadingBlocks = ref(false)
const currentlyReceivingHash = ref<string | null>(null)
const receiveError = ref<string | null>(null)
const currentPage = ref(0)
const pageSize = ref(10)
const hasMore = ref(false)

// Toast
const toast = useToast()

onMounted(async () => {
  await wallet.loadWalletData()
  if (wallet.activeAccountAddress.value) {
    await loadUnreceivedBlocks()
  }
})

async function loadUnreceivedBlocks() {
  if (!wallet.activeAccountAddress.value) return

  isLoadingBlocks.value = true
  try {
    const result = await account.loadUnreceivedBlocks(currentPage.value, pageSize.value)
    unreceivedBlocks.value = result.list || []
    hasMore.value = result.more || false
  } catch (error) {
    console.error('Failed to load unreceived blocks:', error)
    toast.show('Failed to load pending transactions', 'error')
  } finally {
    isLoadingBlocks.value = false
  }
}

async function handleReceive(block: AccountBlock) {
  if (!wallet.activeAccountAddress.value || !wallet.activeWallet.value) return

  currentlyReceivingHash.value = block.hash.toString()
  receiveError.value = null

  try {
    await transaction.receiveTransaction(
      wallet.activeWallet.value,
      wallet.activeAccountAddress.value,
      block.hash.toString()
    )

    // Remove the received block from the list
    unreceivedBlocks.value = unreceivedBlocks.value.filter(
      (b) => b.hash.toString() !== block.hash.toString()
    )

    // Update unreceived count
    await account.loadUnreceivedCount()

    // Show success toast
    toast.show('Transaction received successfully!', 'success')
  } catch (error: any) {
    receiveError.value = error?.message || 'Failed to receive transaction'
  } finally {
    currentlyReceivingHash.value = null
  }
}

async function nextPage() {
  currentPage.value++
  await loadUnreceivedBlocks()
}

async function prevPage() {
  if (currentPage.value > 0) {
    currentPage.value--
    await loadUnreceivedBlocks()
  }
}

function goBack() {
  router.push('/')
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
        <Heading as="h1">Receive</Heading>
      </div>
    </div>

    <!-- Content -->
    <div class="container mx-auto max-w-4xl p-6">
      <!-- No Account Warning -->
      <Card v-if="!wallet.activeAccountAddress.value">
        <CardContent class="py-12 text-center text-muted-foreground">
          <WalletIcon class="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p>No active account. Please create or select a wallet first.</p>
        </CardContent>
      </Card>

      <!-- Main Content -->
      <div v-else class="space-y-6">
        <!-- Address Display -->
        <Card>
          <CardHeader>
            <Heading as="h3" :level="4">Your Address</Heading>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="min-w-0 flex-1 rounded-md bg-muted p-4 font-mono text-sm break-all">
                {{ wallet.activeAccountAddress.value }}
              </div>
              <CopyButton
                :value="wallet.activeAccountAddress.value ?? ''"
                size="default"
                class="w-full sm:w-auto"
              />
            </div>
            <p class="text-center text-sm text-muted-foreground">
              Share this address to receive tokens
            </p>
          </CardContent>
        </Card>

        <!-- Unreceived Transactions -->
        <Card>
          <CardHeader>
            <Heading as="h3" :level="4">Pending Transactions</Heading>
          </CardHeader>
          <CardContent>
            <div v-if="isLoadingBlocks" class="space-y-3 py-4">
              <Skeleton class="h-20 w-full" />
              <Skeleton class="h-20 w-full" />
              <Skeleton class="h-20 w-full" />
            </div>

            <div
              v-else-if="unreceivedBlocks.length === 0"
              class="py-8 text-center text-muted-foreground"
            >
              <ArrowDownCircleIcon class="mx-auto mb-3 h-12 w-12 opacity-50" />
              <p>No pending transactions</p>
            </div>

            <div v-else class="space-y-3">
              <!-- Error Message -->
              <Alert v-if="receiveError" variant="destructive">
                <AlertDescription>{{ receiveError }}</AlertDescription>
              </Alert>

              <!-- Transaction List -->
              <Item
                v-for="block in unreceivedBlocks"
                :key="block.hash.toString()"
                variant="muted"
                class="flex-col items-stretch border-border sm:flex-row sm:items-center"
              >
                <ItemContent class="min-w-0 flex-1">
                  <ItemTitle class="flex items-center gap-2">
                    <TxDirection direction="in" />
                    <Amount
                      :value="
                        addNumberDecimals(block.amount.toString(), block.token?.decimals ?? 8)
                      "
                      :decimals="block.token?.decimals ?? 8"
                      :symbol="block.token?.symbol ?? 'Unknown'"
                    />
                  </ItemTitle>
                  <ItemDescription class="line-clamp-none space-y-2">
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">From</div>
                      <Address :address="block.address.toString()" :copy="false" />
                    </div>
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">ZTS</div>
                      <div class="font-mono break-all text-foreground">
                        {{ block.tokenStandard.toString() }}
                      </div>
                    </div>
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">Time</div>
                      <div class="text-foreground">
                        {{ formatDate(block.confirmationDetail?.momentumTimestamp || 0) }}
                      </div>
                    </div>
                  </ItemDescription>
                </ItemContent>
                <ItemActions class="shrink-0">
                  <Button
                    @click="handleReceive(block)"
                    :disabled="currentlyReceivingHash === block.hash.toString()"
                    size="sm"
                    class="w-full sm:w-auto"
                  >
                    <span
                      v-if="currentlyReceivingHash === block.hash.toString()"
                      class="flex items-center gap-2"
                    >
                      <Spinner class="size-4" />Receiving...
                    </span>
                    <span v-else>Receive</span>
                  </Button>
                </ItemActions>
              </Item>

              <!-- Pagination -->
              <div class="flex items-center justify-between pt-4">
                <Button
                  @click="prevPage"
                  :disabled="currentPage === 0 || isLoadingBlocks"
                  variant="outline"
                  size="sm"
                >
                  Previous
                </Button>
                <span class="text-sm text-muted-foreground">Page {{ currentPage + 1 }}</span>
                <Button
                  @click="nextPage"
                  :disabled="!hasMore || isLoadingBlocks"
                  variant="outline"
                  size="sm"
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

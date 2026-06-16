<script setup lang="ts">
import {onMounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {formatDate, useAccount, useTransaction, useWallet} from '@/core'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  useToast
} from '@nom/ui'
import type {AccountBlock} from 'znn-typescript-sdk'
import {addNumberDecimals} from 'znn-typescript-sdk'
import {ArrowDownCircleIcon, ArrowLeftIcon, CopyIcon} from 'lucide-vue-next'

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

function copyAddress() {
  if (wallet.activeAccountAddress.value) {
    navigator.clipboard.writeText(wallet.activeAccountAddress.value)
    toast.show('Address copied to clipboard!', 'success')
  }
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <!-- Full Page Overlay -->
  <div class="fixed inset-0 bg-background z-50 overflow-y-auto">
    <!-- Header with Back Button -->
    <div class="border-b sticky top-0 bg-background z-10">
      <div class="container mx-auto p-4 flex items-center gap-4">
        <Button
          @click="goBack"
          variant="outline"
          title="Go back"
        >
          <ArrowLeftIcon />
        </Button>
        <h1 class="text-2xl font-bold">Receive</h1>
      </div>
    </div>

    <!-- Content -->
    <div class="container mx-auto p-6 max-w-4xl">
      <!-- No Account Warning -->
      <Card v-if="!wallet.activeAccountAddress.value">
        <CardContent class="text-center py-12 text-muted-foreground">
          No active account. Please create or select a wallet first.
        </CardContent>
      </Card>

      <!-- Main Content -->
      <div v-else class="space-y-6">
        <!-- Address Display -->
        <Card>
          <CardHeader>
            <h3 class="text-xl font-semibold">Your Address</h3>
          </CardHeader>
          <CardContent class="space-y-4">
            <div class="p-4 bg-muted rounded-md break-all font-mono text-sm">
              {{ wallet.activeAccountAddress.value }}
            </div>
            <Button @click="copyAddress" class="w-full">
              <CopyIcon/>
              Copy Address
            </Button>
            <p class="text-sm text-muted-foreground text-center">
              Share this address to receive tokens
            </p>
          </CardContent>
        </Card>

        <!-- Unreceived Transactions -->
        <Card>
          <CardHeader>
            <h3 class="text-xl font-semibold">Pending Transactions</h3>
          </CardHeader>
          <CardContent>
            <div v-if="isLoadingBlocks" class="text-center py-8 text-muted-foreground">
              Loading transactions...
            </div>

            <div v-else-if="unreceivedBlocks.length === 0" class="text-center py-8 text-muted-foreground">
              <ArrowDownCircleIcon class="w-12 h-12 mx-auto mb-3 opacity-50" />
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
                class="border-border flex-col items-stretch sm:flex-row sm:items-center"
              >
                <ItemContent class="flex-1 min-w-0">
                  <ItemTitle>
                    {{ block.token ? addNumberDecimals(block.amount, block.token.decimals) : block.amount.toString() }}
                    {{ block.token?.symbol || 'Unknown' }}
                  </ItemTitle>
                  <ItemDescription class="space-y-2 line-clamp-none">
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">From</div>
                      <div class="font-mono break-all text-foreground">{{ block.address.toString() }}</div>
                    </div>
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">ZTS</div>
                      <div class="font-mono break-all text-foreground">{{ block.tokenStandard.toString() }}</div>
                    </div>
                    <div>
                      <div class="text-xs font-medium text-muted-foreground">Time</div>
                      <div class="text-foreground">{{ formatDate(block.confirmationDetail?.momentumTimestamp || 0) }}</div>
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
                    <span v-if="currentlyReceivingHash === block.hash.toString()">Receiving...</span>
                    <span v-else>Receive</span>
                  </Button>
                </ItemActions>
              </Item>

              <!-- Pagination -->
              <div class="flex justify-between items-center pt-4">
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

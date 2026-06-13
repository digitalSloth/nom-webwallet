<script setup lang="ts">
import {computed, inject, onMounted, ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {formatNumber, formatTokenDisplay, useAccount, useToken, useWallet} from '@/core'
import {Button, Card, CardContent, CardHeader, Item, ItemContent, ItemGroup, ItemSeparator,} from 'nom-ui'
import {ArrowDownCircleIcon, ArrowLeftIcon, ArrowUpCircleIcon} from 'lucide-vue-next'
import {addNumberDecimals} from 'znn-typescript-sdk'

const router = useRouter()
const route = useRoute()

// Use composables
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)
const token = useToken()

// Inject requestUnlock from App.vue
const requestUnlock = inject<(path?: string) => void>('requestUnlock')!

const tokenStandard = ref<string>('')

// Computed - keep for checking if wallet is locked
const isWalletLocked = computed(() => !wallet.isActiveWalletUnlocked.value)

// Get user's balance for this specific token
const tokenBalance = computed(() => {
  const balance = account.balances.value.find((b) => b.tokenStandard === tokenStandard.value)
  return balance || null
})

const formattedBalance = computed(() => {
  if (!tokenBalance.value) return '0'
  return addNumberDecimals(tokenBalance.value.balance, tokenBalance.value.decimals)
})

const formattedBalanceCompact = computed(() => {
  if (!tokenBalance.value) return '0'
  return formatNumber(formattedBalance.value, { decimals: 2, compact: true })
})

onMounted(async () => {
  tokenStandard.value = route.params.tokenStandard as string

  if (!tokenStandard.value) {
    router.push('/')
    return
  }

  await wallet.loadWalletData()

  if (wallet.activeAccountAddress.value) {
    await Promise.all([
      account.loadAccountData(),
      token.loadTokenInfo(tokenStandard.value)
    ])
  }
})

function goBack() {
  router.push('/')
}

// Handle navigation with unlock check
function handleNavigateToSendReceive(path: string) {
  if (isWalletLocked.value) {
    requestUnlock(path)
  } else {
    // For send, pass the token standard as a query param
    if (path === '/send' && tokenStandard.value) {
      router.push({ path: '/send', query: { token: tokenStandard.value } })
    } else {
      router.push(path)
    }
  }
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
        <h1 class="text-2xl font-bold">
          {{ tokenBalance?.symbol || 'Token Details' }}
        </h1>
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

      <!-- Loading State -->
      <Card v-else-if="token.isLoading.value || account.isLoading.value">
        <CardContent class="text-center py-12 text-muted-foreground">
          Loading token information...
        </CardContent>
      </Card>

      <!-- Error State -->
      <Card v-else-if="token.error.value || !token.tokenInfo.value">
        <CardContent class="text-center py-12 text-muted-foreground">
          <p>Failed to load token information</p>
          <Button @click="goBack" variant="outline" class="mt-4">
            Go Back
          </Button>
        </CardContent>
      </Card>

      <!-- Token Details -->
      <div v-else class="space-y-6">
        <!-- Balance Display -->
        <Card>
          <CardContent class="py-8 text-center">
            <div class="text-sm text-muted-foreground mb-2">Your Balance</div>
            <div
              class="text-5xl font-mono font-bold mb-6"
              :title="formattedBalance"
            >
              {{ formattedBalanceCompact }}
            </div>
            <div class="text-xl text-muted-foreground mb-6">
              {{ tokenBalance?.symbol || 'Unknown' }}
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-3 justify-center max-w-md mx-auto">
              <Button
                @click="handleNavigateToSendReceive('/send')"
                variant="outline"
                class="flex-1 flex items-center justify-center gap-2 border-primary/50 hover:border-primary hover:bg-primary/10"
              >
                <ArrowUpCircleIcon class="text-primary" />
                <span class="font-medium">Send</span>
              </Button>

              <Button
                @click="handleNavigateToSendReceive('/receive')"
                variant="outline"
                class="flex-1 flex items-center justify-center gap-2 border-primary/50 hover:border-primary hover:bg-primary/10"
              >
                <ArrowDownCircleIcon class="text-primary" />
                <span class="font-medium">Receive</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- Token Information -->
        <Card>
          <CardHeader>
            <h3 class="text-xl font-semibold">Token Information</h3>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground shrink-0">Name</span>
                  <span class="font-medium break-words sm:text-right">{{ token.tokenInfo.value.name || 'N/A' }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground">Symbol</span>
                  <span class="font-medium">{{ token.tokenInfo.value.symbol || 'N/A' }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground shrink-0">Token Standard</span>
                  <span class="font-mono text-sm break-all sm:text-right">{{ tokenStandard }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground">Decimals</span>
                  <span class="font-medium">{{ token.tokenInfo.value.decimals }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground shrink-0">Total Supply</span>
                  <span
                    class="font-mono break-all sm:text-right"
                    :title="addNumberDecimals(token.tokenInfo.value.totalSupply.toString(), token.tokenInfo.value.decimals)"
                  >
                    {{ formatTokenDisplay(addNumberDecimals(token.tokenInfo.value.totalSupply.toString(), token.tokenInfo.value.decimals)) }}
                  </span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground shrink-0">Max Supply</span>
                  <span
                    class="font-mono break-all sm:text-right"
                    :title="addNumberDecimals(token.tokenInfo.value.maxSupply.toString(), token.tokenInfo.value.decimals)"
                  >
                    {{ formatTokenDisplay(addNumberDecimals(token.tokenInfo.value.maxSupply.toString(), token.tokenInfo.value.decimals)) }}
                  </span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-start sm:gap-2">
                  <span class="text-muted-foreground shrink-0">Owner</span>
                  <span class="font-mono text-sm break-all sm:text-right">
                    {{ token.tokenInfo.value.owner.toString() }}
                  </span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <template v-if="token.tokenInfo.value.domain">
                <Item size="sm">
                  <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                    <span class="text-muted-foreground">Domain</span>
                    <span class="font-medium">{{ token.tokenInfo.value.domain }}</span>
                  </ItemContent>
                </Item>
                <ItemSeparator />
              </template>

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground">Mintable</span>
                  <span class="font-medium">{{ token.tokenInfo.value.isMintable ? 'Yes' : 'No' }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground">Burnable</span>
                  <span class="font-medium">{{ token.tokenInfo.value.isBurnable ? 'Yes' : 'No' }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent class="flex-col items-start gap-0.5 sm:flex-row sm:justify-between sm:items-center sm:gap-2">
                  <span class="text-muted-foreground">Utility</span>
                  <span class="font-medium">{{ token.tokenInfo.value.isUtility ? 'Yes' : 'No' }}</span>
                </ItemContent>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

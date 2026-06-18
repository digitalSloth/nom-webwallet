<script setup lang="ts">
import {computed, inject, onMounted, ref} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import { useAccount, useToken, useWallet} from '@/core'
import {
  Address,
 Amount, Button,
  Card,
  CardContent,
  CardHeader,
  Heading,
  Item,
  ItemContent,
  ItemGroup,
  ItemSeparator,
  Spinner,
} from 'nom-ui'
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

onMounted(async () => {
  tokenStandard.value = route.params.tokenStandard as string

  if (!tokenStandard.value) {
    router.push('/')
    return
  }

  await wallet.loadWalletData()

  if (wallet.activeAccountAddress.value) {
    await Promise.all([account.loadAccountData(), token.loadTokenInfo(tokenStandard.value)])
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
  <div class="fixed inset-0 z-50 overflow-y-auto bg-background">
    <!-- Header with Back Button -->
    <div class="sticky top-0 z-10 border-b bg-background">
      <div class="container mx-auto flex items-center gap-4 p-4">
        <Button @click="goBack" variant="outline" title="Go back">
          <ArrowLeftIcon />
        </Button>
        <Heading as="h1">
          {{ tokenBalance?.symbol || 'Token Details' }}
        </Heading>
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

      <!-- Loading State -->
      <Card v-else-if="token.isLoading.value || account.isLoading.value">
        <CardContent class="py-12 text-center text-muted-foreground">
          <Spinner class="mx-auto" />
        </CardContent>
      </Card>

      <!-- Error State -->
      <Card v-else-if="token.error.value || !token.tokenInfo.value">
        <CardContent class="py-12 text-center text-muted-foreground">
          <p>Failed to load token information</p>
          <Button @click="goBack" variant="outline" class="mt-4"> Go Back </Button>
        </CardContent>
      </Card>

      <!-- Token Details -->
      <div v-else class="space-y-6">
        <!-- Balance Display -->
        <Card>
          <CardContent class="py-8 text-center">
            <div class="mb-2 text-ledger text-muted-foreground">Your Balance</div>
            <Amount
              :value="formattedBalance"
              :decimals="2"
              compact
              class="mb-6 block text-5xl font-semibold tracking-tight"
              :title="formattedBalance"
            />
            <div class="mb-6 text-xl text-muted-foreground">
              {{ tokenBalance?.symbol || 'Unknown' }}
            </div>

            <!-- Action Buttons -->
            <div class="mx-auto flex max-w-md justify-center gap-3">
              <Button
                @click="handleNavigateToSendReceive('/send')"
                variant="outline"
                class="flex flex-1 items-center justify-center gap-2 border-primary/50 hover:border-primary hover:bg-primary/10"
              >
                <ArrowUpCircleIcon class="text-muted-foreground" />
                <span class="font-medium">Send</span>
              </Button>

              <Button
                @click="handleNavigateToSendReceive('/receive')"
                variant="outline"
                class="flex flex-1 items-center justify-center gap-2 border-primary/50 hover:border-primary hover:bg-primary/10"
              >
                <ArrowDownCircleIcon class="text-success" />
                <span class="font-medium">Receive</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        <!-- Token Information -->
        <Card>
          <CardHeader>
            <Heading as="h3" :level="4">Token Information</Heading>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="shrink-0 text-muted-foreground">Name</span>
                  <span class="font-medium break-words sm:text-right">{{
                    token.tokenInfo.value.name || 'N/A'
                  }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="text-muted-foreground">Symbol</span>
                  <span class="font-medium">{{ token.tokenInfo.value.symbol || 'N/A' }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="shrink-0 text-muted-foreground">Token Standard</span>
                  <Address :address="tokenStandard" truncate-below="sm" />
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="text-muted-foreground">Decimals</span>
                  <span class="font-medium">{{ token.tokenInfo.value.decimals }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="shrink-0 text-muted-foreground">Total Supply</span>
                  <Amount
                    :value="
                      addNumberDecimals(
                        token.tokenInfo.value.totalSupply.toString(),
                        token.tokenInfo.value.decimals
                      )
                    "
                    :decimals="4"
                    class="sm:text-right"
                    :title="
                      addNumberDecimals(
                        token.tokenInfo.value.totalSupply.toString(),
                        token.tokenInfo.value.decimals
                      )
                    "
                  />
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="shrink-0 text-muted-foreground">Max Supply</span>
                  <Amount
                    :value="
                      addNumberDecimals(
                        token.tokenInfo.value.maxSupply.toString(),
                        token.tokenInfo.value.decimals
                      )
                    "
                    :decimals="4"
                    class="sm:text-right"
                    :title="
                      addNumberDecimals(
                        token.tokenInfo.value.maxSupply.toString(),
                        token.tokenInfo.value.decimals
                      )
                    "
                  />
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2"
                >
                  <span class="shrink-0 text-muted-foreground">Owner</span>
                  <Address :address="token.tokenInfo.value.owner.toString()" />
                </ItemContent>
              </Item>
              <ItemSeparator />

              <template v-if="token.tokenInfo.value.domain">
                <Item size="sm">
                  <ItemContent
                    class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                  >
                    <span class="text-muted-foreground">Domain</span>
                    <span class="font-medium">{{ token.tokenInfo.value.domain }}</span>
                  </ItemContent>
                </Item>
                <ItemSeparator />
              </template>

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="text-muted-foreground">Mintable</span>
                  <span class="font-medium">{{
                    token.tokenInfo.value.isMintable ? 'Yes' : 'No'
                  }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="text-muted-foreground">Burnable</span>
                  <span class="font-medium">{{
                    token.tokenInfo.value.isBurnable ? 'Yes' : 'No'
                  }}</span>
                </ItemContent>
              </Item>
              <ItemSeparator />

              <Item size="sm">
                <ItemContent
                  class="flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                >
                  <span class="text-muted-foreground">Utility</span>
                  <span class="font-medium">{{
                    token.tokenInfo.value.isUtility ? 'Yes' : 'No'
                  }}</span>
                </ItemContent>
              </Item>
            </ItemGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>

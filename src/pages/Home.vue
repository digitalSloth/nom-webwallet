<script setup lang="ts">
import {computed, inject, onMounted, onUnmounted, ref} from 'vue'
import {useRouter} from 'vue-router'
import {formatNumber, useAccount, useWallet} from '@/core'
import {Button, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger, useToast,} from 'nom-ui'
import TokensTab from '@/components/TokensTab.vue'
import RewardsTab from '@/components/RewardsTab.vue'
import PlasmaTab from '@/components/PlasmaTab.vue'
import PillarTab from '@/components/PillarTab.vue'
import StakeTab from '@/components/StakeTab.vue'
import WalletStats from '@/components/WalletStats.vue'
import {ArrowDownCircleIcon, ArrowUpCircleIcon} from 'lucide-vue-next'

const router = useRouter()

// Use composables
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)

// Inject requestUnlock from App.vue
const requestUnlock = inject<(path?: string) => void>('requestUnlock')!

// UI state
const activeTab = ref<'tokens' | 'rewards' | 'plasma' | 'pillar' | 'stake'>('tokens')
const tokensTabRef = ref<InstanceType<typeof TokensTab> | null>(null)

// Toast
const toast = useToast()

// Computed - keep for tabs that still need it
const isWalletLocked = computed(() => !wallet.isActiveWalletUnlocked.value)

onMounted(async () => {
  await wallet.loadWalletData()
  if (wallet.activeAccountAddress.value) {
    await account.loadAccountData()
  }

  // Listen for wallet unlock/lock events
  window.addEventListener('wallet-status-changed', handleWalletStatusChanged)
})

onUnmounted(() => {
  window.removeEventListener('wallet-status-changed', handleWalletStatusChanged)
})

async function handleWalletStatusChanged() {
  await wallet.loadWalletData()
}

function handleRewardsCollected() {
  // Reload both Home balances and TokensTab balances
  account.loadBalances()
  tokensTabRef.value?.loadBalances()
}

function handlePlasmaUpdated() {
  // Reload account balances after plasma fuse/cancel
  account.loadBalances()
  tokensTabRef.value?.loadBalances()
}

function handleStakeUpdated() {
  // Reload account balances after stake/cancel
  account.loadBalances()
  tokensTabRef.value?.loadBalances()
}

function handleDelegationSuccess() {
  account.loadAccountData()
}

// Handle navigation with unlock check
function handleNavigateToSendReceive(path: string) {
  if (isWalletLocked.value) {
    requestUnlock(path)
  } else {
    router.push(path)
  }
}

// Computed formatted balances
const formattedZnnBalance = computed(() =>
  formatNumber(account.znnBalance.value, { decimals: 2, compact: true })
)

const formattedQsrBalance = computed(() =>
  formatNumber(account.qsrBalance.value, { decimals: 2, compact: true })
)
</script>

<template>
  <div class="space-y-6 max-w-4xl mx-auto">
    <!-- No Account Warning -->
    <Card v-if="!wallet.activeAccountAddress.value">
      <CardContent class="text-center py-12 text-muted-foreground">
        No active account. Please create or select a wallet first.
      </CardContent>
    </Card>

    <!-- Main Wallet View -->
    <div v-else class="space-y-6">

      <!-- Compact Balance and Actions -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Balance Display -->
        <div class="flex items-center gap-3 md:col-span-1">
          <div class="flex-1 p-3 rounded-md bg-green-500/10 border border-green-500/20">
            <div class="text-xs text-muted-foreground mb-1">ZNN</div>
            <div
              class="text-2xl font-mono font-bold text-green-600 dark:text-green-400"
              :title="account.znnBalance.value"
            >
              {{ formattedZnnBalance }}
            </div>
          </div>

          <div class="flex-1 p-3 rounded-md bg-blue-500/10 border border-blue-500/20">
            <div class="text-xs text-muted-foreground mb-1">QSR</div>
            <div
              class="text-2xl font-mono font-bold text-blue-600 dark:text-blue-400"
              :title="account.qsrBalance.value"
            >
              {{ formattedQsrBalance }}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-3 md:col-span-1">
          <Button
            @click="handleNavigateToSendReceive('/send')"
            variant="outline"
            class="flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors min-h-19 border-primary/50 hover:border-primary hover:bg-primary/10"
          >
            <ArrowUpCircleIcon class="text-primary" />
            <span class="font-medium text-sm">Send</span>
          </Button>

          <Button
            @click="handleNavigateToSendReceive('/receive')"
            variant="outline"
            class="flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors relative min-h-19 border-primary/50 hover:border-primary hover:bg-primary/10"
          >
            <ArrowDownCircleIcon class="w-6 h-6 text-primary" />
            <span class="font-medium text-sm">Receive</span>
            <span
              v-if="account.unreceivedCount.value > 0"
              class="absolute -top-1 -right-1 bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center"
            >
              {{ account.unreceivedCount.value > 9 ? '9+' : account.unreceivedCount.value }}
            </span>
          </Button>
        </div>
      </div>

      <!-- Wallet Stats -->
      <WalletStats
        :token-count="account.tokenCount.value"
        :account-height="account.accountHeight.value"
        :plasma-level="account.plasmaLevel.value"
        :delegated-pillar="account.delegatedPillar.value"
        :total-znn-rewards="account.totalZnnRewards.value"
        :total-qsr-rewards="account.totalQsrRewards.value"
      />

      <!-- Tabs -->
      <Card>
        <Tabs v-model="activeTab">
          <TabsList variant="underline">
            <TabsTrigger variant="underline" value="tokens">Tokens</TabsTrigger>
            <TabsTrigger variant="underline" value="rewards">Rewards</TabsTrigger>
            <TabsTrigger variant="underline" value="plasma">Plasma</TabsTrigger>
            <TabsTrigger variant="underline" value="pillar">Pillar</TabsTrigger>
            <TabsTrigger variant="underline" value="stake">Staking</TabsTrigger>
          </TabsList>
          <CardContent class="p-6">

            <TabsContent value="tokens">
              <TokensTab
                ref="tokensTabRef"
                :active-account-address="wallet.activeAccountAddress.value"
                :is-active="activeTab === 'tokens'"
              />
            </TabsContent>

            <TabsContent value="rewards">
              <RewardsTab
                :active-account-address="wallet.activeAccountAddress.value"
                :is-active="activeTab === 'rewards'"
                :is-wallet-locked="isWalletLocked"
                @show-toast="toast.show"
                @rewards-collected="handleRewardsCollected"
              />
            </TabsContent>

            <TabsContent value="plasma">
              <PlasmaTab
                :active-account-address="wallet.activeAccountAddress.value"
                :is-active="activeTab === 'plasma'"
                :is-wallet-locked="isWalletLocked"
                @show-toast="toast.show"
                @plasma-updated="handlePlasmaUpdated"
              />
            </TabsContent>

            <TabsContent value="pillar">
              <PillarTab
                :active-account-address="wallet.activeAccountAddress.value"
                :is-active="activeTab === 'pillar'"
                :is-wallet-locked="isWalletLocked"
                @show-toast="toast.show"
                @delegation-success="handleDelegationSuccess"
              />
            </TabsContent>

            <TabsContent value="stake">
              <StakeTab
                :active-account-address="wallet.activeAccountAddress.value"
                :is-active="activeTab === 'stake'"
                :is-wallet-locked="isWalletLocked"
                @show-toast="toast.show"
                @stake-updated="handleStakeUpdated"
              />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  </div>
</template>

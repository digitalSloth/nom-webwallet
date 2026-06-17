<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAccount, useWallet } from '@/core'
import {
  Amount,
  Button,
  Card,
  CardContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from 'nom-ui'
import TokensTab from '@/components/TokensTab.vue'
import RewardsTab from '@/components/RewardsTab.vue'
import PlasmaTab from '@/components/PlasmaTab.vue'
import PillarTab from '@/components/PillarTab.vue'
import StakeTab from '@/components/StakeTab.vue'
import WalletStats from '@/components/WalletStats.vue'
import { ArrowDownCircleIcon, ArrowUpCircleIcon, WalletIcon } from 'lucide-vue-next'

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
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-6">
    <!-- No Account Warning -->
    <Card v-if="!wallet.activeAccountAddress.value">
      <CardContent class="py-12 text-center text-muted-foreground">
        <WalletIcon class="mx-auto mb-3 h-12 w-12 opacity-50" />
        <p>No active account. Please create or select a wallet first.</p>
      </CardContent>
    </Card>

    <!-- Main Wallet View -->
    <div v-else class="space-y-6">
      <!-- Compact Balance and Actions -->
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <!-- Balance Display -->
        <div class="flex items-center gap-3 md:col-span-1">
          <div class="flex-1 rounded-md border border-primary/20 bg-primary/20 p-3">
            <div class="mb-1 text-xs text-muted-foreground">ZNN</div>
            <Amount
              :value="account.znnBalance.value"
              :decimals="2"
              :compact="true"
              class="text-2xl font-bold"
              :title="account.znnBalance.value"
            />
          </div>

          <div class="flex-1 rounded-md border border-info/20 bg-info/20 p-3">
            <div class="mb-1 text-xs text-muted-foreground">QSR</div>
            <Amount
              :value="account.qsrBalance.value"
              :decimals="2"
              :compact="true"
              class="text-2xl font-bold"
              :title="account.qsrBalance.value"
            />
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-2 gap-3 md:col-span-1">
          <Button
            @click="handleNavigateToSendReceive('/send')"
            variant="outline"
            class="flex min-h-20 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/40 transition-colors hover:border-primary/40 hover:bg-primary/10"
          >
            <ArrowUpCircleIcon class="h-7 w-7 text-primary" />
            <span class="text-sm font-medium">Send</span>
          </Button>

          <Button
            @click="handleNavigateToSendReceive('/receive')"
            variant="outline"
            class="relative flex min-h-20 flex-col items-center justify-center gap-1 rounded-md border border-border bg-muted/40 transition-colors hover:border-primary/40 hover:bg-primary/10"
          >
            <ArrowDownCircleIcon class="h-7 w-7 text-primary" />
            <span class="text-sm font-medium">Receive</span>
            <span
              v-if="account.unreceivedCount.value > 0"
              class="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
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

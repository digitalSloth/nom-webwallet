<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAccount, useNetwork, useWallet } from '@/core'
import { Amount, Button, Tabs, TabsContent, TabsList, TabsTrigger, TokenIcon } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import PopupHeader from '../components/PopupHeader.vue'
import StatusBar from '../components/StatusBar.vue'
import TokenRows from '../components/TokenRows.vue'
import ActivityList from '../components/ActivityList.vue'
import TxToast from '@/shared/components/TxToast.vue'
import { urlHost } from '@/shared/lib/format'
import { injectSmallHost } from '@/apps/small/host'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)
const network = useNetwork()

const host = injectSmallHost()

const activeTab = ref<'tokens' | 'activity'>(route.query.tab === 'activity' ? 'activity' : 'tokens')

// Home loads nothing itself: the app shell loads wallet and account data on
// start, on every route change and on account change.
function openAction(path: string): void {
  if (wallet.isActiveWalletUnlocked.value) void router.push(path)
  else host.requestUnlock(path)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PopupHeader />
    <StatusBar
      :connected="network.isConnected.value"
      :node-down="network.nodeDown.value"
      :chain-id="network.chainId.value"
      :plasma-level="wallet.activeAccountAddress.value ? account.plasmaLevel.value : null"
    />

    <div
      v-if="network.nodeDown.value"
      role="alert"
      class="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-destructive px-3 py-2.5 text-xs"
    >
      <span class="flex-1">
        Can't reach {{ urlHost(network.currentNode.value) }}. Balances may be out of date and
        sending is paused.
      </span>
      <RouterLink
        :to="{ name: 'settings-network' }"
        class="font-medium whitespace-nowrap text-info"
      >
        Change node
      </RouterLink>
    </div>

    <div
      v-if="!wallet.activeAccountAddress.value"
      class="flex-1 py-12 text-center text-muted-foreground"
    >
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <div class="grid grid-cols-2 gap-3 px-4">
        <div class="rounded-lg border bg-card px-3 py-2.5">
          <div class="flex items-center gap-1.5">
            <TokenIcon symbol="ZNN" class="size-4" />
            <span class="text-ledger text-muted-foreground">ZNN</span>
          </div>
          <Amount
            :value="account.znnBalance.value"
            :decimals="2"
            :compact="true"
            class="mt-1 block text-[22px] font-semibold"
          />
        </div>
        <div class="rounded-lg border bg-card px-3 py-2.5">
          <div class="flex items-center gap-1.5">
            <TokenIcon symbol="QSR" class="size-4" />
            <span class="text-ledger text-muted-foreground">QSR</span>
          </div>
          <Amount
            :value="account.qsrBalance.value"
            :decimals="2"
            :compact="true"
            class="mt-1 block text-[22px] font-semibold"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 px-4 py-3">
        <Button
          variant="default"
          :disabled="network.nodeDown.value || account.isNewAccount.value"
          @click="openAction('/send')"
          >Send</Button
        >
        <Button variant="outline" @click="openAction('/receive')">Receive</Button>
      </div>

      <button
        v-if="account.unreceivedCount.value > 0"
        type="button"
        class="mx-4 mb-3 flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm"
        @click="openAction('/receive')"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <span class="flex-1">
          {{
            account.unreceivedCount.value === 1
              ? '1 incoming transaction'
              : `${account.unreceivedCount.value} incoming transactions`
          }}
        </span>
        <span class="text-info">Receive all</span>
      </button>

      <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
        <TabsList variant="underline">
          <TabsTrigger variant="underline" value="tokens">Tokens</TabsTrigger>
          <TabsTrigger variant="underline" value="activity">Activity</TabsTrigger>
        </TabsList>
        <div
          v-if="account.isNewAccount.value"
          class="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-4 text-center"
        >
          <span class="text-sm font-semibold">
            {{ activeTab === 'tokens' ? 'No tokens yet' : 'No activity yet' }}
          </span>
          <span class="text-xs leading-normal text-muted-foreground">
            Send ZNN or QSR to your address to get started. You can get free plasma before your
            first send.
          </span>
          <RouterLink :to="{ name: 'receive' }" class="text-[13px] font-medium text-info">
            Show my address
          </RouterLink>
        </div>
        <div v-else class="flex-1 overflow-y-auto">
          <TabsContent value="tokens">
            <TokenRows :balances="account.balances.value" :is-loading="account.isLoading.value" />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityList :address="wallet.activeAccountAddress.value" />
          </TabsContent>
        </div>
      </Tabs>
    </template>

    <TxToast />
  </div>
</template>

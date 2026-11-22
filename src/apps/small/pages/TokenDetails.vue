<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addNumberDecimals } from 'znn-typescript-sdk'
import { useAccount, useToken, useWallet } from '@/core'
import { Address, Amount, Badge, Button, Spinner, TokenIcon } from 'nom-ui'
import PageHeader from '../components/PageHeader.vue'
import { formatAmount } from '@/shared/lib/amount'
import { explorerAccountUrl, shortAddress } from '@/shared/lib/format'
import { sendFormStash } from '@/shared/lib/send-draft'

const route = useRoute()
const router = useRouter()
const token = useToken()
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)

const standard = computed(() => String(route.params.tokenStandard))

watch(
  () => route.params.tokenStandard,
  (zts) => void token.loadTokenInfo(String(zts)),
  { immediate: true }
)

// The token ref is shared, so it can still hold another token until this one loads.
const info = computed(() =>
  token.tokenInfo.value?.tokenStandard.toString() === standard.value ? token.tokenInfo.value : null
)

const balance = computed(() => {
  const row = account.balances.value.find((b) => b.tokenStandard === standard.value)
  return row ? addNumberDecimals(row.balance, row.decimals) : '0'
})

function home(): void {
  void router.push('/')
}

function send(): void {
  const address = wallet.activeAccountAddress.value
  if (address) {
    sendFormStash.value = { address, tokenStandard: standard.value, amount: '', recipient: '' }
  }
  void router.push({ name: 'send' })
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader :title="info?.name ?? 'Token'" @back="home" />

    <div v-if="token.isLoading.value && !info" class="flex flex-1 items-center justify-center">
      <Spinner class="size-6" />
    </div>

    <div v-else-if="!info" class="flex flex-1 flex-col items-center justify-center gap-4 p-6">
      <p class="text-sm text-muted-foreground">Token not found</p>
      <Button variant="outline" @click="home">Back</Button>
    </div>

    <div v-else class="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div class="flex flex-col items-center gap-1.5 pt-2 text-center">
        <TokenIcon :symbol="info.symbol" class="size-10" />
        <span class="text-ledger text-muted-foreground">Your balance</span>
        <Amount
          :value="balance"
          :decimals="info.decimals"
          :symbol="info.symbol"
          class="text-[22px] font-semibold"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button variant="default" class="w-full" @click="send">Send</Button>
        <Button variant="outline" class="w-full" @click="router.push({ name: 'receive' })">
          Receive
        </Button>
      </div>

      <dl
        class="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2.5 rounded-xl border bg-card p-3 text-[13px]"
      >
        <dt class="self-center text-ledger text-muted-foreground">Symbol</dt>
        <dd>{{ info.symbol }}</dd>
        <dt class="self-center text-ledger text-muted-foreground">Standard</dt>
        <dd><Address :address="standard" :start="8" :end="4" copy /></dd>
        <dt class="self-center text-ledger text-muted-foreground">Decimals</dt>
        <dd class="font-mono">{{ info.decimals }}</dd>
        <dt class="self-center text-ledger text-muted-foreground">Total supply</dt>
        <dd class="font-mono">
          {{ formatAmount(info.totalSupply, info.decimals) }} {{ info.symbol }}
        </dd>
        <dt class="self-center text-ledger text-muted-foreground">Max supply</dt>
        <dd class="font-mono">
          {{ formatAmount(info.maxSupply, info.decimals) }} {{ info.symbol }}
        </dd>
        <dt class="self-center text-ledger text-muted-foreground">Owner</dt>
        <dd>
          <a
            :href="explorerAccountUrl(info.owner.toString())"
            target="_blank"
            rel="noopener noreferrer"
            class="font-mono text-info underline-offset-4 hover:underline"
            >{{ shortAddress(info.owner.toString()) }}</a
          >
        </dd>
        <dt class="self-center text-ledger text-muted-foreground">Domain</dt>
        <dd>{{ info.domain || '—' }}</dd>
        <dt class="self-center text-ledger text-muted-foreground">Properties</dt>
        <dd class="flex flex-wrap gap-1">
          <Badge v-if="info.isMintable" variant="secondary">Mintable</Badge>
          <Badge v-if="info.isBurnable" variant="secondary">Burnable</Badge>
          <Badge :variant="info.isUtility ? 'secondary' : 'outline'">
            {{ info.isUtility ? 'Utility' : 'Not utility' }}
          </Badge>
        </dd>
      </dl>
    </div>
  </div>
</template>

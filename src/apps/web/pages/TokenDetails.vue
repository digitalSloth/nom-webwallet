<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { addNumberDecimals } from 'znn-typescript-sdk'
import { useAccount, useToken, useWallet } from '@/core'
import { Address, Amount, Button, Spinner, TokenIcon } from 'nom-ui'
import { ChevronLeftIcon } from 'lucide-vue-next'
import { formatAmount } from '@/shared/lib/amount'
import { explorerAccountUrl } from '@/shared/lib/format'
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

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No')

const facts = computed(() => {
  const t = info.value
  if (!t) return []
  const supply = (value: bigint | number | string) =>
    `${formatAmount(BigInt(value), t.decimals)} ${t.symbol}`
  return [
    { label: 'Name', value: t.name, mono: false },
    { label: 'Symbol', value: t.symbol, mono: false },
    { label: 'Decimals', value: String(t.decimals), mono: true },
    { label: 'Domain', value: t.domain || '—', mono: false },
    { label: 'Total supply', value: supply(t.totalSupply), mono: true },
    { label: 'Max supply', value: supply(t.maxSupply), mono: true },
    { label: 'Mintable', value: yesNo(t.isMintable), mono: false },
    { label: 'Burnable', value: yesNo(t.isBurnable), mono: false },
    { label: 'Utility', value: yesNo(t.isUtility), mono: false },
  ]
})

function home(): void {
  void router.push({ name: 'home' })
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
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <RouterLink
      :to="{ name: 'home' }"
      class="flex items-center gap-1.5 text-[13px] text-foreground no-underline"
    >
      <ChevronLeftIcon class="size-3.5" aria-hidden="true" />
      Dashboard
    </RouterLink>

    <div v-if="token.isLoading.value && !info" class="flex justify-center py-16">
      <Spinner class="size-6" />
    </div>

    <div v-else-if="!info" class="flex flex-col items-center gap-4 py-16">
      <p class="text-sm text-muted-foreground">Token not found</p>
      <Button variant="outline" @click="home">Back</Button>
    </div>

    <template v-else>
      <section class="flex flex-wrap items-center gap-5 rounded-xl border bg-card p-6 shadow-md">
        <TokenIcon :symbol="info.symbol" class="size-12" />
        <div class="flex flex-[1_1_260px] flex-col gap-1">
          <h1 class="text-[26px] font-semibold">
            {{ info.name }}
            <span class="text-base font-medium text-muted-foreground">{{ info.symbol }}</span>
          </h1>
          <span class="flex items-baseline gap-2">
            <span class="text-ledger text-muted-foreground">Your balance</span>
            <Amount
              :value="balance"
              :decimals="info.decimals"
              :symbol="info.symbol"
              dim-trailing-zeros
              class="text-xl font-semibold"
            />
          </span>
        </div>
        <div class="flex gap-2">
          <Button size="lg" @click="send">Send</Button>
          <Button variant="outline" size="lg" @click="router.push({ name: 'receive' })">
            Receive
          </Button>
        </div>
      </section>

      <section aria-labelledby="web-token-info" class="rounded-xl border bg-card">
        <h2 id="web-token-info" class="border-b px-5 py-4 text-base font-semibold">
          Token information
        </h2>
        <dl
          class="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-8 gap-y-3.5 px-5 py-4 text-sm"
        >
          <div
            v-for="fact in facts"
            :key="fact.label"
            class="flex justify-between gap-3 border-b pb-3"
          >
            <dt class="text-ledger text-muted-foreground">{{ fact.label }}</dt>
            <dd :class="['m-0 text-right', fact.mono && 'font-mono']">{{ fact.value }}</dd>
          </div>
          <div class="flex justify-between gap-3 border-b pb-3">
            <dt class="text-ledger text-muted-foreground">Token standard</dt>
            <dd class="m-0"><Address :address="standard" :start="10" :end="6" copy /></dd>
          </div>
          <div class="flex justify-between gap-3 border-b pb-3">
            <dt class="text-ledger text-muted-foreground">Owner</dt>
            <dd class="m-0">
              <Address
                :address="info.owner.toString()"
                :start="10"
                :end="6"
                :copy="false"
                :href="explorerAccountUrl(info.owner.toString())"
              />
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>

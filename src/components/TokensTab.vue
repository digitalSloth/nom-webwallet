<script setup lang="ts">
import {onMounted, watch} from 'vue'
import {useRouter} from 'vue-router'
import {useAccount} from '@/core'
import TokenList from './TokenList.vue'
import type {BalanceInfo} from '@/types'

interface TokensTabProps {
  activeAccountAddress: string | null
  isActive?: boolean
}

const props = withDefaults(defineProps<TokensTabProps>(), {
  isActive: false,
})

const router = useRouter()
const account = useAccount(() => props.activeAccountAddress)

// Load on mount if active and account exists
onMounted(async () => {
  if (props.isActive && props.activeAccountAddress) {
    await account.loadBalances()
  }
})

// Watch for when the tab becomes active
watch(
  () => props.isActive,
  async (isActive) => {
    if (isActive && props.activeAccountAddress) {
      await account.loadBalances()
    }
  }
)

// Watch for account changes
watch(
  () => props.activeAccountAddress,
  async (newAddress) => {
    if (newAddress && props.isActive) {
      await account.loadBalances()
    }
  }
)

function handleTokenClick(token: BalanceInfo) {
  router.push(`/token/${token.tokenStandard}`)
}

// Expose for parent components
defineExpose({
  balances: account.balances,
  loadBalances: account.loadBalances,
})
</script>

<template>
  <div>
    <div v-if="account.isLoading.value" class="py-8 text-center text-muted-foreground">
      Loading balances...
    </div>
    <div
      v-else-if="account.balances.value.length === 0"
      class="py-8 text-center text-muted-foreground"
    >
      No tokens found
    </div>
    <TokenList
      v-else
      :tokens="account.balances.value"
      :searchable="true"
      :clickable="true"
      @click="handleTokenClick"
    />
  </div>
</template>

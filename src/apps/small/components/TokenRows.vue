<script setup lang="ts">
import { computed } from 'vue'
import { Amount, Skeleton, TokenIcon } from 'nom-ui'
import { addNumberDecimals, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { BalanceInfo } from '@/types'

const props = defineProps<{ balances: BalanceInfo[]; isLoading: boolean }>()

const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()

function rank(balance: BalanceInfo): number {
  if (balance.tokenStandard === ZNN) return 0
  if (balance.tokenStandard === QSR) return 1
  return 2
}

const sorted = computed(() =>
  [...props.balances].sort(
    (a, b) => rank(a) - rank(b) || (a.symbol ?? '').localeCompare(b.symbol ?? '')
  )
)
</script>

<template>
  <div v-if="isLoading && balances.length === 0" class="space-y-3 p-4">
    <Skeleton v-for="n in 4" :key="n" class="h-10 w-full" />
  </div>
  <p v-else-if="balances.length === 0" class="p-6 text-center text-sm text-muted-foreground">
    No tokens yet
  </p>
  <ul v-else class="divide-y">
    <li v-for="balance in sorted" :key="balance.tokenStandard">
      <RouterLink
        :to="{ name: 'token', params: { tokenStandard: balance.tokenStandard } }"
        class="flex items-center gap-3 px-4 py-3 hover:bg-muted"
      >
        <TokenIcon :symbol="balance.symbol ?? ''" class="size-8" />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold">{{ balance.symbol }}</div>
          <div class="truncate text-xs text-muted-foreground">
            {{ balance.name || balance.tokenStandard }}
          </div>
        </div>
        <Amount
          :value="addNumberDecimals(balance.balance, balance.decimals)"
          :decimals="Math.min(balance.decimals, 4)"
          class="text-sm"
        />
      </RouterLink>
    </li>
  </ul>
</template>

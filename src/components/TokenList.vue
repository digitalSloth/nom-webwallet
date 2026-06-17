<script setup lang="ts">
import {computed, ref} from 'vue'
import {addNumberDecimals, QSR_ZTS, ZNN_ZTS} from 'znn-typescript-sdk'
import type {BalanceInfo} from '@/types'
import {Amount, Badge, Input, Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle, TokenIcon} from 'nom-ui'

export interface TokenListProps {
  tokens: BalanceInfo[]
  searchable?: boolean
  selectable?: boolean
  clickable?: boolean
}

const props = withDefaults(defineProps<TokenListProps>(), {
  searchable: false,
  selectable: false,
  clickable: false,
})

const emit = defineEmits<{
  select: [token: BalanceInfo]
  click: [token: BalanceInfo]
}>()

const searchQuery = ref('')

const sortedAndFilteredTokens = computed(() => {
  let filtered = props.tokens

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (token) =>
        token.symbol?.toLowerCase().includes(query) ||
        token.name?.toLowerCase().includes(query) ||
        token.tokenStandard.toLowerCase().includes(query)
    )
  }

  // Sort: ZNN first, QSR second, rest by balance
  return [...filtered].sort((a, b) => {
    const aIsZNN = a.tokenStandard === ZNN_ZTS.toString()
    const bIsZNN = b.tokenStandard === ZNN_ZTS.toString()
    const aIsQSR = a.tokenStandard === QSR_ZTS.toString()
    const bIsQSR = b.tokenStandard === QSR_ZTS.toString()

    // ZNN always first
    if (aIsZNN && !bIsZNN) return -1
    if (!aIsZNN && bIsZNN) return 1

    // QSR always second (after ZNN)
    if (aIsQSR && !bIsQSR && !bIsZNN) return -1
    if (!aIsQSR && bIsQSR && !aIsZNN) return 1

    // If both are ZNN or both are QSR, maintain order
    if ((aIsZNN && bIsZNN) || (aIsQSR && bIsQSR)) return 0

    // Sort rest by balance (descending) - convert strings to numbers for proper comparison
    const balanceA = parseFloat(addNumberDecimals(a.balance, a.decimals))
    const balanceB = parseFloat(addNumberDecimals(b.balance, b.decimals))
    return balanceB - balanceA
  })
})

function handleItemClick(token: BalanceInfo) {
  if (props.selectable) {
    emit('select', token)
  } else if (props.clickable) {
    emit('click', token)
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Search Input -->
    <Input v-if="searchable" v-model="searchQuery" placeholder="Search tokens..." class="w-full" />

    <!-- Token List -->
    <div v-if="sortedAndFilteredTokens.length === 0" class="py-8 text-center text-muted-foreground">
      <p v-if="searchQuery">No tokens found matching "{{ searchQuery }}"</p>
      <p v-else>No tokens available</p>
    </div>

    <div v-else class="space-y-2">
      <Item
        v-for="token in sortedAndFilteredTokens"
        :key="token.tokenStandard"
        :variant="selectable || clickable ? 'hover' : 'muted'"
        size="sm"
        @click="(selectable || clickable) && handleItemClick(token)"
      >
        <ItemMedia>
          <TokenIcon :symbol="token.symbol ?? 'Unknown'" class="size-8" />
        </ItemMedia>
        <ItemContent class="flex-1">
          <ItemTitle class="flex items-center gap-2">
            {{ token.symbol || 'Unknown' }}
            <Badge
              v-if="
                token.tokenStandard === ZNN_ZTS.toString() ||
                token.tokenStandard === QSR_ZTS.toString()
              "
              variant="secondary"
            >
              Core
            </Badge>
          </ItemTitle>
          <ItemDescription>
            {{ token.name || token.tokenStandard }}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Amount
            :value="addNumberDecimals(token.balance, token.decimals)"
            :decimals="token.decimals"
          />
        </ItemActions>
      </Item>
    </div>
  </div>
</template>

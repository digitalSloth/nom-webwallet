<script setup lang="ts">
import { ref } from 'vue'
import { Amount, Popover, PopoverContent, PopoverTrigger, TokenIcon } from 'nom-ui'
import { ChevronDownIcon } from 'lucide-vue-next'
import type { BalanceInfo } from '@/types'
import { formatAmount } from '@/shared/lib/amount'

defineProps<{ tokens: BalanceInfo[]; modelValue: BalanceInfo | null }>()
const emit = defineEmits<{ 'update:modelValue': [token: BalanceInfo] }>()

const open = ref(false)

function available(token: BalanceInfo): string {
  return formatAmount(BigInt(token.balance), token.decimals)
}

function pick(token: BalanceInfo): void {
  emit('update:modelValue', token)
  open.value = false
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        type="button"
        class="flex h-12 w-full items-center gap-3 rounded-md border bg-card px-3 text-left"
      >
        <template v-if="modelValue">
          <TokenIcon :symbol="modelValue.symbol ?? ''" class="size-7" />
          <span class="flex-1">
            <span class="block text-sm font-medium">{{ modelValue.symbol }}</span>
            <span class="block text-xs text-muted-foreground">Available</span>
          </span>
          <Amount
            :value="available(modelValue)"
            :decimals="Math.min(modelValue.decimals, 4)"
            class="text-sm"
          />
        </template>
        <span v-else class="flex-1 text-sm text-muted-foreground">Select a token</span>
        <ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="max-h-64 w-[var(--reka-popover-trigger-width)] overflow-y-auto p-1">
      <button
        v-for="token in tokens"
        :key="token.tokenStandard"
        type="button"
        class="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-accent"
        @click="pick(token)"
      >
        <TokenIcon :symbol="token.symbol ?? ''" class="size-7" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-medium">{{ token.symbol }}</span>
          <span class="block truncate text-xs text-muted-foreground">{{ token.name }}</span>
        </span>
        <Amount :value="available(token)" :decimals="Math.min(token.decimals, 4)" class="text-sm" />
      </button>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
import type {PillarWithApr} from '@/core'
import {Amount, Button, Item, ItemContent, ItemDescription, ItemTitle} from 'nom-ui'
import {addNumberDecimals} from 'znn-typescript-sdk'

export interface PillarListProps {
  pillars: PillarWithApr[]
  currentDelegatedPillar: string | null
  isDelegating?: boolean
  delegatingToPillar?: string | null
  isWalletLocked?: boolean
  searchQuery?: string
}

withDefaults(defineProps<PillarListProps>(), {
  isDelegating: false,
  delegatingToPillar: null,
  isWalletLocked: false,
  searchQuery: '',
})

const emit = defineEmits<{
  delegate: [pillarName: string]
}>()

function formatApr(apr: number): string {
  if (apr === 0) return 'N/A'
  return `${apr.toFixed(2)}%`
}
</script>

<template>
  <div v-if="pillars.length === 0" class="py-8 text-center text-muted-foreground">
    <p v-if="searchQuery">No pillars found matching "{{ searchQuery }}"</p>
    <p v-else>No pillars available</p>
  </div>

  <Item
    v-for="pillarInfo in pillars"
    :key="pillarInfo.name"
    variant="muted"
    :class="[
      'border-border transition-colors',
      currentDelegatedPillar === pillarInfo.name ? 'border-primary/50 bg-primary/10' : '',
    ]"
  >
    <ItemContent>
      <!-- Mobile: Stack layout -->
      <div class="flex flex-col space-y-3 sm:hidden">
        <!-- Top row: Name and rank -->
        <div class="flex items-start justify-between">
          <div>
            <ItemDescription class="mb-1 text-xs">
              Rank #{{ pillarInfo.rank + 1 }}
            </ItemDescription>
            <ItemTitle>
              {{ pillarInfo.name }}
            </ItemTitle>
          </div>
        </div>

        <!-- Stats row -->
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <ItemDescription class="mb-1 text-xs">Est. APR</ItemDescription>
            <div class="font-mono font-medium text-success tabular-nums">
              {{ formatApr(pillarInfo.delegateApr) }}
            </div>
          </div>
          <div>
            <ItemDescription class="mb-1 text-xs">Weight</ItemDescription>
            <Amount
              :value="addNumberDecimals(pillarInfo.weight.toString(), 8)"
              :decimals="2"
              compact
              symbol="ZNN"
              class="font-medium"
            />
          </div>
        </div>

        <!-- Button row -->
        <Button
          @click="emit('delegate', pillarInfo.name)"
          :disabled="isDelegating || isWalletLocked || currentDelegatedPillar === pillarInfo.name"
          size="sm"
          class="w-full"
          :variant="currentDelegatedPillar === pillarInfo.name ? 'secondary' : 'default'"
        >
          <span v-if="delegatingToPillar === pillarInfo.name">Delegating...</span>
          <span v-else-if="currentDelegatedPillar === pillarInfo.name">Delegated</span>
          <span v-else>Delegate</span>
        </Button>
      </div>

      <!-- Desktop: Grid layout -->
      <div class="hidden grid-cols-4 items-center gap-4 sm:grid">
        <!-- Pillar Name -->
        <div class="text-left">
          <ItemDescription class="mb-1 text-xs"> Rank #{{ pillarInfo.rank + 1 }} </ItemDescription>
          <ItemTitle>
            {{ pillarInfo.name }}
          </ItemTitle>
        </div>

        <!-- Est. APR -->
        <div class="text-center">
          <ItemDescription class="mb-1 text-xs" title="Estimated annual return for delegators">
            Est. APR
          </ItemDescription>
          <div class="font-mono text-sm font-medium text-success tabular-nums">
            {{ formatApr(pillarInfo.delegateApr) }}
          </div>
        </div>

        <!-- Weight -->
        <div class="text-center">
          <ItemDescription class="mb-1 text-xs" title="Total delegated weight">
            Weight
          </ItemDescription>
          <Amount
            :value="addNumberDecimals(pillarInfo.weight.toString(), 8)"
            :decimals="2"
            compact
            symbol="ZNN"
            class="text-sm font-medium"
          />
        </div>

        <!-- Delegate Button -->
        <div class="text-right">
          <Button
            @click="emit('delegate', pillarInfo.name)"
            :disabled="isDelegating || isWalletLocked || currentDelegatedPillar === pillarInfo.name"
            size="sm"
            :variant="currentDelegatedPillar === pillarInfo.name ? 'secondary' : 'default'"
          >
            <span v-if="delegatingToPillar === pillarInfo.name">Delegating...</span>
            <span v-else-if="currentDelegatedPillar === pillarInfo.name">Delegated</span>
            <span v-else>Delegate</span>
          </Button>
        </div>
      </div>
    </ItemContent>
  </Item>
</template>

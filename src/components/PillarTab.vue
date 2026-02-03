<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {useAccount, usePillar, useWallet} from '@/core'
import {Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useToast,} from '@nom/ui'
import PillarList from './PillarList.vue'

export interface PillarTabProps {
  activeAccountAddress: string | null
  isActive: boolean
  isWalletLocked: boolean
}

const props = defineProps<PillarTabProps>()

const emit = defineEmits<{
  showToast: [message: string, type: 'success' | 'error' | 'info']
  delegationSuccess: []
}>()

const pillar = usePillar()
const wallet = useWallet()
const account = useAccount(() => props.activeAccountAddress)
const searchQuery = ref('')
const delegatingToPillar = ref<string | null>(null)
const sortBy = ref<'rank' | 'apr'>('rank')
const toast = useToast()

// Load pillars on mount if tab is active
onMounted(async () => {
  if (props.isActive && pillar.pillars.value.length === 0) {
    await pillar.loadPillars()
  }
})

// Load pillars when tab becomes active
watch(() => props.isActive, async (isActive) => {
  if (isActive && pillar.pillars.value.length === 0) {
    await pillar.loadPillars()
  }
})

// Filter and sort pillars
const filteredPillars = computed(() => {
  let filtered = pillar.pillars.value

  // Filter by search query
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter((p) => p.name.toLowerCase().includes(query))
  }

  // Sort based on selected option
  return [...filtered].sort((a, b) => {
    if (sortBy.value === 'apr') {
      // Sort by APR (descending), then by rank
      if (b.delegateApr !== a.delegateApr) {
        return b.delegateApr - a.delegateApr
      }
      return a.rank - b.rank
    } else {
      // Sort by rank (ascending)
      return a.rank - b.rank
    }
  })
})

async function handleDelegate(pillarName: string) {
  if (props.isWalletLocked) {
    toast.show('Please unlock your wallet first', 'error')
    return
  }

  if (!wallet.activeWallet.value || !props.activeAccountAddress) {
    toast.show('Wallet is not available', 'error')
    return
  }

  delegatingToPillar.value = pillarName

  try {
    const shouldUndelegate = account.delegatedPillar.value !== null && account.delegatedPillar.value !== pillarName
    await pillar.delegateToPillar(wallet.activeWallet.value, props.activeAccountAddress, pillarName, shouldUndelegate)
    toast.show('Successfully delegated to pillar', 'success')
    emit('delegationSuccess')
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Failed to delegate to pillar'
    toast.show(errorMessage, 'error')
  } finally {
    delegatingToPillar.value = null
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Search and Sort Controls -->
    <div class="flex flex-col sm:flex-row gap-2">
      <Input
        v-model="searchQuery"
        placeholder="Search pillars by name..."
        class="w-full sm:flex-1"
        :disabled="pillar.isLoading.value || pillar.isDelegating.value"
      />
      <Select
        v-model="sortBy"
        :disabled="pillar.isLoading.value || pillar.isDelegating.value"
      >
        <SelectTrigger class="sm:w-[160px]">
          <SelectValue placeholder="Sort by..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apr">Sort by APR</SelectItem>
          <SelectItem value="rank">Sort by Rank</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Loading State -->
    <div v-if="pillar.isLoading.value" class="text-center py-8 text-muted-foreground">
      Loading pillars and calculating APRs...
    </div>

    <!-- Pillar List -->
    <PillarList
      v-else
      :pillars="filteredPillars"
      :current-delegated-pillar="account.delegatedPillar.value"
      :is-delegating="pillar.isDelegating.value"
      :delegating-to-pillar="delegatingToPillar"
      :is-wallet-locked="isWalletLocked"
      :search-query="searchQuery"
      @delegate="handleDelegate"
    />
  </div>
</template>

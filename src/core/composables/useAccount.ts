import {computed, ref, watch} from 'vue'
import type {PlasmaLevel} from "../account-service";
import {AccountService} from '../account-service'
import {RewardsService} from '../rewards-service'
import type {BalanceInfo} from '@/types'
import {addNumberDecimals, QSR_ZTS, ZNN_ZTS} from 'znn-typescript-sdk'

// Module-level reactive state — shared across every useAccount() caller
const balances = ref<BalanceInfo[]>([])
const plasmaLevel = ref<PlasmaLevel>('low')
const currentPlasma = ref<number>(0)
const unreceivedCount = ref(0)
const isLoading = ref(false)
const error = ref<string | null>(null)
const accountHeight = ref<number>(0)
const delegatedPillar = ref<string | null>(null)
const totalZnnRewards = ref<string>('0')
const totalQsrRewards = ref<string>('0')

// Computed balances
const znnBalance = computed(() => {
  const znn = balances.value.find((b) => b.tokenStandard === ZNN_ZTS.toString())
  return znn ? addNumberDecimals(znn.balance, znn.decimals) : '0'
})

const qsrBalance = computed(() => {
  const qsr = balances.value.find((b) => b.tokenStandard === QSR_ZTS.toString())
  return qsr ? addNumberDecimals(qsr.balance, qsr.decimals) : '0'
})

const tokenCount = computed(() => {
  return balances.value.filter((b) => BigInt(b.balance) > 0n).length
})

const POLL_INTERVAL_MS = 30_000

let pollTimer: ReturnType<typeof setInterval> | null = null

function startPolling(fn: () => void) {
  stopPolling()
  pollTimer = setInterval(fn, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function useAccount(accountAddress: string | null | (() => string | null)) {
  const accountService = AccountService.getInstance()
  const rewardsService = RewardsService.getInstance()

  // Computed account address (handle both static and reactive)
  const address = computed(() => {
    if (typeof accountAddress === 'function') {
      return accountAddress()
    }
    return accountAddress
  })

  // Load account balances
  async function loadBalances() {
    if (!address.value) {
      balances.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const accInfo = await accountService.getAccountInfo(address.value)

      balances.value = Object.entries(accInfo?.balanceInfoMap || {}).map(([zts, info]) => ({
        tokenStandard: zts,
        balance: info.balance.toString(),
        decimals: info.token.decimals,
        symbol: info.token.symbol,
        name: info.token.name,
      }))

      // Update account height from blockCount
      accountHeight.value = accInfo?.blockCount || 0
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load balances'
      console.error('Failed to load account balances:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Load plasma info
  async function loadPlasmaInfo() {
    if (!address.value) {
      plasmaLevel.value = 'low'
      currentPlasma.value = 0
      return
    }

    try {
      const plasmaInfo = await accountService.getPlasmaInfo(address.value)
      currentPlasma.value = plasmaInfo.currentPlasma
      plasmaLevel.value = accountService.getPlasmaLevel(plasmaInfo.currentPlasma)
    } catch (err) {
      console.error('Failed to load plasma info:', err)
      plasmaLevel.value = 'low'
      currentPlasma.value = 0
    }
  }

  // Load unreceived blocks count
  async function loadUnreceivedCount() {
    if (!address.value) {
      unreceivedCount.value = 0
      return
    }

    try {
      const result = await accountService.getUnreceivedBlocks(address.value, 0, 1)
      unreceivedCount.value = result.count || result.list?.length || 0
    } catch (err) {
      console.error('Failed to load unreceived count:', err)
      unreceivedCount.value = 0
    }
  }

  // Load delegation info
  async function loadDelegationInfo() {
    if (!address.value) {
      delegatedPillar.value = null
      return
    }

    try {
      const delegation = await accountService.getDelegatedPillar(address.value)
      delegatedPillar.value = delegation?.name || null
    } catch (err) {
      console.error('Failed to load delegation info:', err)
      delegatedPillar.value = null
    }
  }

  // Load rewards info
  async function loadRewardsInfo() {
    if (!address.value) {
      totalZnnRewards.value = '0'
      totalQsrRewards.value = '0'
      return
    }

    try {
      const rewards = await rewardsService.getAllUncollectedRewards(address.value)

      const znnTotal = rewards.reduce((sum, reward) => {
        return sum + BigInt(reward.reward.znnAmount.toString())
      }, 0n)

      const qsrTotal = rewards.reduce((sum, reward) => {
        return sum + BigInt(reward.reward.qsrAmount.toString())
      }, 0n)

      totalZnnRewards.value = addNumberDecimals(znnTotal.toString(), 8)
      totalQsrRewards.value = addNumberDecimals(qsrTotal.toString(), 8)
    } catch (err) {
      console.error('Failed to load rewards info:', err)
      totalZnnRewards.value = '0'
      totalQsrRewards.value = '0'
    }
  }

  // Load unreceived blocks (paginated)
  async function loadUnreceivedBlocks(page: number = 0, pageSize: number = 10) {
    if (!address.value) {
      return { list: [], count: 0, more: false }
    }

    try {
      return await accountService.getUnreceivedBlocks(address.value, page, pageSize)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load unreceived blocks'
      console.error('Failed to load unreceived blocks:', err)
      return { list: [], count: 0, more: false }
    }
  }

  // Load all account data
  async function loadAccountData() {
    if (!address.value) return

    isLoading.value = true
    error.value = null

    try {
      await Promise.all([
        loadBalances(),
        loadPlasmaInfo(),
        loadUnreceivedCount(),
        loadDelegationInfo(),
        loadRewardsInfo()
      ])
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load account data'
    } finally {
      isLoading.value = false
    }
  }

  // Refresh all data
  async function refresh() {
    await loadAccountData()
  }

  // Watch address changes, reload data and maintain polling
  watch(address, (newAddress) => {
    if (newAddress) {
      loadAccountData()
      startPolling(loadAccountData)
    } else {
      stopPolling()
      balances.value = []
      plasmaLevel.value = 'low'
      currentPlasma.value = 0
      unreceivedCount.value = 0
      accountHeight.value = 0
      delegatedPillar.value = null
      totalZnnRewards.value = '0'
      totalQsrRewards.value = '0'
    }
  })

  return {
    // State
    balances,
    plasmaLevel,
    currentPlasma,
    unreceivedCount,
    isLoading,
    error,
    accountHeight,
    delegatedPillar,
    totalZnnRewards,
    totalQsrRewards,

    // Computed
    znnBalance,
    qsrBalance,
    tokenCount,

    // Methods
    loadBalances,
    loadPlasmaInfo,
    loadUnreceivedCount,
    loadDelegationInfo,
    loadRewardsInfo,
    loadUnreceivedBlocks,
    loadAccountData,
    refresh,
  }
}

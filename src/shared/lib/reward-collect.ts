import { computed, onScopeDispose, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { RewardType, usePillar, useRewards, useStake, useWallet } from '@/core'
import { REWARD_SOURCE_LABELS, REWARD_TYPES } from '@/core/rewards-service'
import { collectMeta, collectableSources } from '@/core/composables/useRewards'
import { onTxProgress, useTrackedTransactions } from '@/core/composables/useTxTracker'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { claimPending, isPending, runPending, settlePending } from './pending-calls'

export interface RewardCollectDeps {
  /** The page's account, captured once at setup. */
  address: string | null
  wallet: Pick<
    ReturnType<typeof useWallet>,
    'activeAccountAddress' | 'activeWallet' | 'isActiveWalletUnlocked' | 'refreshLockState'
  >
  rewards: Pick<
    ReturnType<typeof useRewards>,
    'rewards' | 'rewardsFor' | 'loadRewards' | 'loadHistory' | 'collectReward' | 'collectAll'
  >
  pillar: Pick<ReturnType<typeof usePillar>, 'delegation' | 'delegationFor' | 'loadDelegation'>
  stake: Pick<ReturnType<typeof useStake>, 'stakeEntries' | 'stakeEntriesFor' | 'loadStakeEntries'>
}

export interface RewardRow {
  type: RewardType
  znn: bigint
  qsr: bigint
  has: boolean
}

export interface CollectFailure {
  message: string
  timeout: boolean
}

const collectKey = (address: string, type: RewardType) => `collect:${address}:${type}`
const labelOf = (type: RewardType) => REWARD_SOURCE_LABELS[type].toLowerCase()

/**
 * The Rewards collect flow shared by both layouts. Call it in a page's
 * setup; it loads the account's rewards at once and reloads them on every
 * transaction stage of that account.
 */
export function useRewardCollect(deps: RewardCollectDeps): {
  loaded: ComputedRef<boolean>
  rows: ComputedRef<RewardRow[]>
  totals: ComputedRef<{ znn: bigint; qsr: bigint }>
  collectable: ComputedRef<RewardType[]>
  submitting: Ref<boolean>
  failure: Ref<CollectFailure | null>
  retryable: Ref<boolean>
  delegationLoaded: ComputedRef<boolean>
  stakesLoaded: ComputedRef<boolean>
  delegationText: ComputedRef<string>
  isCollecting: (type: RewardType) => boolean
  detail: (type: RewardType) => string
  load: () => void
  collectOne: (type: RewardType) => Promise<void>
  collectAll: () => Promise<void>
  tryAgain: () => Promise<void>
} {
  const { wallet, rewards, pillar, stake, address } = deps
  const active = () => wallet.activeAccountAddress.value

  const submitting = ref(false)
  const failure = ref<CollectFailure | null>(null)
  const retryable = ref(false)

  async function reload(): Promise<void> {
    if (!address) return
    await Promise.all([
      rewards.loadRewards(address),
      pillar.loadDelegation(address),
      stake.loadStakeEntries(address),
    ])
  }

  function load(): void {
    if (!address) return
    void reload()
    void rewards.loadHistory(address)
  }

  const stop = onTxProgress((tx) => {
    if (address && tx.address === address) void reload()
  })
  onScopeDispose(stop)
  load()

  const loaded = computed(() => rewards.rewardsFor.value === address)
  const delegationLoaded = computed(() => pillar.delegationFor.value === address)
  const stakesLoaded = computed(() => stake.stakeEntriesFor.value === address)
  const delegationText = computed(() =>
    pillar.delegation.value ? `Delegating to ${pillar.delegation.value.name}` : 'Not delegating'
  )

  // The shared list only counts once it was loaded for this page's account.
  const list = computed(() => (loaded.value ? rewards.rewards.value : []))

  const rows = computed<RewardRow[]>(() =>
    REWARD_TYPES.map((type) => {
      const entry = list.value.find((r) => r.type === type)
      const znn = BigInt(entry?.reward.znnAmount ?? 0n)
      const qsr = BigInt(entry?.reward.qsrAmount ?? 0n)
      return { type, znn, qsr, has: znn > 0n || qsr > 0n }
    })
  )

  const totals = computed(() => ({
    znn: rows.value.reduce((sum, r) => sum + r.znn, 0n),
    qsr: rows.value.reduce((sum, r) => sum + r.qsr, 0n),
  }))

  // A tracked, unfinished collect also counts: a reopened popup or a second
  // surface has no pending claim, but the tracker knows the published hash.
  const tracked = useTrackedTransactions().entries
  const isCollecting = (type: RewardType): boolean =>
    isPending(collectKey(address ?? '', type)) ||
    tracked.value.some(
      (e) => !e.done && e.tx.address === address && e.tx.meta?.title === collectMeta(type, '').title
    )

  const collectable = computed(() => collectableSources(list.value).filter((t) => !isCollecting(t)))

  function detail(type: RewardType): string {
    switch (type) {
      case 'pillar':
        return delegationLoaded.value ? delegationText.value : ''
      case 'stake': {
        if (!stakesLoaded.value) return ''
        const count = stake.stakeEntries.value.length
        return `${count} active ${count === 1 ? 'stake' : 'stakes'}`
      }
      case 'sentinel':
        return 'Sentinel rewards'
      case 'liquidity':
        return 'Liquidity program'
    }
  }

  // Locked wallets show the locked overlay; the check re-reads the session first.
  function unlocked(): boolean {
    wallet.refreshLockState()
    return wallet.activeWallet.value !== null && wallet.isActiveWalletUnlocked.value
  }

  function fail(type: RewardType, err: unknown): void {
    const message = err instanceof Error ? err.message : 'Failed to collect reward'
    failure.value = {
      message: `Couldn't collect ${labelOf(type)} rewards: ${message}`,
      timeout: message === SEND_TIMEOUT_MESSAGE,
    }
  }

  async function collectOne(type: RewardType): Promise<void> {
    const from = active()
    const activeWallet = wallet.activeWallet.value
    if (!from || !activeWallet || rewards.rewardsFor.value !== from) return
    if (!unlocked()) return
    if (submitting.value) return
    failure.value = null
    retryable.value = false
    submitting.value = true
    try {
      await runPending(collectKey(from, type), () =>
        rewards.collectReward(
          activeWallet,
          from,
          type,
          collectMeta(type, `Collecting ${labelOf(type)} rewards`)
        )
      )
    } catch (err) {
      fail(type, err)
    } finally {
      submitting.value = false
    }
  }

  async function collectAll(): Promise<void> {
    const from = active()
    const activeWallet = wallet.activeWallet.value
    if (!from || !activeWallet || rewards.rewardsFor.value !== from) return
    if (!unlocked()) return
    if (submitting.value) return
    const claimed = collectable.value.filter((t) => claimPending(collectKey(from, t)))
    if (claimed.length === 0) return
    submitting.value = true
    failure.value = null
    retryable.value = false
    const settled = new Set<RewardType>()
    const settle = (type: RewardType, outcome: { hash: string } | 'unknown' | 'none') => {
      settled.add(type)
      settlePending(collectKey(from, type), outcome)
    }
    try {
      const result = await rewards.collectAll(activeWallet, from, claimed)
      for (const c of result.collected) settle(c.type, { hash: c.hash })
      if (result.failed) {
        const timeout = result.failed.message === SEND_TIMEOUT_MESSAGE
        settle(result.failed.type, timeout ? 'unknown' : 'none')
        failure.value = {
          message: `Couldn't collect ${labelOf(result.failed.type)} rewards: ${result.failed.message}`,
          timeout,
        }
        retryable.value = !timeout
      }
    } finally {
      for (const type of claimed) if (!settled.has(type)) settle(type, 'none')
      if (active() === from) await rewards.loadRewards(from)
      submitting.value = false
    }
  }

  async function tryAgain(): Promise<void> {
    const from = active()
    if (from) await rewards.loadRewards(from)
    await collectAll()
  }

  return {
    loaded,
    rows,
    totals,
    collectable,
    submitting,
    failure,
    retryable,
    delegationLoaded,
    stakesLoaded,
    delegationText,
    isCollecting,
    detail,
    load,
    collectOne,
    collectAll,
    tryAgain,
  }
}

import { effectScope, ref } from 'vue'
import type { EffectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const trackedEntries = vi.hoisted(() => ({ value: [] as unknown[] }))
const listeners = new Set<(tx: { address: string }) => void>()

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: () => null, entries: trackedEntries }),
  onTxProgress: (listener: (tx: { address: string }) => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}))

import { collectMeta } from '@/core/composables/useRewards'
import type { RewardType } from '@/core'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { must } from '@/test/must'
import { useRewardCollect } from './reward-collect'
import type { RewardCollectDeps } from './reward-collect'

type Entry = { type: RewardType; reward: { znnAmount: bigint; qsrAmount: bigint } }
const entry = (type: RewardType, znn: bigint, qsr = 0n): Entry => ({
  type,
  reward: { znnAmount: znn, qsrAmount: qsr },
})

let n = 0
const scopes: EffectScope[] = []

function setup(opts: { rewards?: Entry[]; unlocked?: boolean; loadedFor?: string | null } = {}) {
  const address = `z1reward${n++}`
  const activeAddress = ref<string | null>(address)
  const delegation = ref<{ name: string } | null>(null)
  const stakeEntries = ref<{ amount: bigint }[]>([])
  const deps = {
    address,
    wallet: {
      activeAccountAddress: activeAddress,
      activeWallet: ref({ baseAddress: address }),
      isActiveWalletUnlocked: ref(opts.unlocked ?? true),
      refreshLockState: vi.fn(),
    },
    rewards: {
      rewards: ref(opts.rewards ?? []),
      rewardsFor: ref<string | null>(opts.loadedFor === undefined ? address : opts.loadedFor),
      loadRewards: vi.fn(async () => {}),
      loadHistory: vi.fn(async () => {}),
      collectReward: vi.fn(async () => ({ hash: `hash-${address}` })),
      collectAll: vi.fn(async (_w: unknown, _a: string, types: RewardType[]) => ({
        collected: types.map((type) => ({ type, hash: `hash-${address}-${type}` })),
        failed: null as { type: RewardType; message: string } | null,
      })),
    },
    pillar: {
      delegation,
      delegationFor: ref<string | null>(null),
      loadDelegation: vi.fn(async () => {}),
    },
    stake: {
      stakeEntries,
      stakeEntriesFor: ref<string | null>(null),
      loadStakeEntries: vi.fn(async () => {}),
    },
  }
  const scope = effectScope()
  scopes.push(scope)
  const state = must(scope.run(() => useRewardCollect(deps as unknown as RewardCollectDeps)))
  return { address, activeAddress, deps, state, scope, delegation, stakeEntries }
}

afterEach(() => {
  for (const s of scopes.splice(0)) s.stop()
  listeners.clear()
  trackedEntries.value = []
})

describe('loading', () => {
  it('loads rewards, delegation, stakes and history for the account at once', () => {
    const { address, deps } = setup()
    expect(deps.rewards.loadRewards).toHaveBeenCalledWith(address)
    expect(deps.pillar.loadDelegation).toHaveBeenCalledWith(address)
    expect(deps.stake.loadStakeEntries).toHaveBeenCalledWith(address)
    expect(deps.rewards.loadHistory).toHaveBeenCalledWith(address)
  })

  it('loads nothing without an account', () => {
    const deps = {
      address: null,
      wallet: {
        activeAccountAddress: ref(null),
        activeWallet: ref(null),
        isActiveWalletUnlocked: ref(false),
        refreshLockState: vi.fn(),
      },
      rewards: {
        rewards: ref([]),
        rewardsFor: ref(null),
        loadRewards: vi.fn(),
        loadHistory: vi.fn(),
        collectReward: vi.fn(),
        collectAll: vi.fn(),
      },
      pillar: { delegation: ref(null), delegationFor: ref(null), loadDelegation: vi.fn() },
      stake: { stakeEntries: ref([]), stakeEntriesFor: ref(null), loadStakeEntries: vi.fn() },
    }
    const scope = effectScope()
    scopes.push(scope)
    scope.run(() => useRewardCollect(deps as unknown as RewardCollectDeps))
    expect(deps.rewards.loadRewards).not.toHaveBeenCalled()
    expect(deps.rewards.loadHistory).not.toHaveBeenCalled()
    expect(listeners.size).toBe(1)
    for (const l of listeners) l({ address: 'z1any' })
    expect(deps.rewards.loadRewards).not.toHaveBeenCalled()
  })

  it('reloads on a transaction stage of the account', () => {
    const { address, deps } = setup()
    deps.rewards.loadRewards.mockClear()
    for (const l of listeners) l({ address })
    expect(deps.rewards.loadRewards).toHaveBeenCalledWith(address)
  })

  it("ignores another account's stage", () => {
    const { deps } = setup()
    deps.rewards.loadRewards.mockClear()
    for (const l of listeners) l({ address: 'z1other' })
    expect(deps.rewards.loadRewards).not.toHaveBeenCalled()
  })

  it('stops listening when the scope stops', () => {
    const { scope } = setup()
    expect(listeners.size).toBe(1)
    scope.stop()
    expect(listeners.size).toBe(0)
  })
})

describe('rows and totals', () => {
  it('counts rewards only once they are loaded for the account', () => {
    const { state } = setup({ rewards: [entry('pillar', 5n)], loadedFor: 'z1other' })
    expect(state.loaded.value).toBe(false)
    expect(state.totals.value).toEqual({ znn: 0n, qsr: 0n })
  })

  it('builds rows in REWARD_TYPES order with has flags and totals', () => {
    const { state } = setup({
      rewards: [entry('liquidity', 3n, 2n), entry('pillar', 5n), entry('stake', 0n)],
    })
    expect(state.rows.value.map((r) => r.type)).toEqual([
      'pillar',
      'stake',
      'sentinel',
      'liquidity',
    ])
    expect(state.rows.value.map((r) => r.has)).toEqual([true, false, false, true])
    expect(state.totals.value).toEqual({ znn: 8n, qsr: 2n })
  })
})

describe('tracked collects', () => {
  const tracked = (address: string, type: RewardType, done: boolean) => ({
    tx: { hash: `h-${address}-${type}`, address, meta: collectMeta(type, 'x') },
    done,
  })

  it('excludes a source with an unfinished tracked collect and no pending claim', () => {
    const { address, state } = setup({ rewards: [entry('stake', 1n), entry('pillar', 2n)] })
    trackedEntries.value = [tracked(address, 'stake', false)]
    expect(state.isCollecting('stake')).toBe(true)
    expect(state.collectable.value).toEqual(['pillar'])
  })

  it('ignores finished collects and other accounts', () => {
    const { address, state } = setup({ rewards: [entry('stake', 1n)] })
    trackedEntries.value = [tracked(address, 'stake', true), tracked('z1other', 'stake', false)]
    expect(state.collectable.value).toEqual(['stake'])
  })
})

describe('collectAll', () => {
  it('collects every collectable source in order and keeps each pending by hash', async () => {
    const { address, deps, state } = setup({
      rewards: [entry('stake', 1n), entry('pillar', 2n)],
    })
    deps.rewards.loadRewards.mockClear()
    await state.collectAll()
    expect(deps.rewards.collectAll).toHaveBeenCalledWith(expect.anything(), address, [
      'pillar',
      'stake',
    ])
    expect(state.isCollecting('pillar')).toBe(true)
    expect(state.isCollecting('stake')).toBe(true)
    expect(state.collectable.value).toEqual([])
    expect(deps.rewards.loadRewards).toHaveBeenCalledWith(address)
    expect(state.submitting.value).toBe(false)
  })

  it('names the failed source and offers a retry', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n), entry('pillar', 2n)] })
    deps.rewards.collectAll.mockResolvedValueOnce({
      collected: [{ type: 'pillar', hash: 'h1' }],
      failed: { type: 'stake', message: 'boom' },
    })
    await state.collectAll()
    expect(state.failure.value).toEqual({
      message: "Couldn't collect staking rewards: boom",
      timeout: false,
    })
    expect(state.retryable.value).toBe(true)
    expect(state.isCollecting('stake')).toBe(false)
    expect(state.isCollecting('pillar')).toBe(true)
  })

  it('keeps a timed-out source pending and offers no retry', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n)] })
    deps.rewards.collectAll.mockResolvedValueOnce({
      collected: [],
      failed: { type: 'stake', message: SEND_TIMEOUT_MESSAGE },
    })
    await state.collectAll()
    expect(state.failure.value?.timeout).toBe(true)
    expect(state.retryable.value).toBe(false)
    expect(state.isCollecting('stake')).toBe(true)
  })

  it('collects nothing while the wallet is locked', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n)], unlocked: false })
    await state.collectAll()
    await state.collectOne('stake')
    expect(deps.wallet.refreshLockState).toHaveBeenCalled()
    expect(deps.rewards.collectAll).not.toHaveBeenCalled()
    expect(deps.rewards.collectReward).not.toHaveBeenCalled()
  })

  it('collects nothing when the active account changed', async () => {
    const { activeAddress, deps, state } = setup({ rewards: [entry('stake', 1n)] })
    activeAddress.value = 'z1changed'
    await state.collectAll()
    await state.collectOne('stake')
    expect(deps.rewards.collectAll).not.toHaveBeenCalled()
    expect(deps.rewards.collectReward).not.toHaveBeenCalled()
  })
})

describe('collectOne', () => {
  it('collects one source with its own progress text', async () => {
    const { address, deps, state } = setup({ rewards: [entry('stake', 1n)] })
    await state.collectOne('stake')
    expect(deps.rewards.collectReward).toHaveBeenCalledWith(
      expect.anything(),
      address,
      'stake',
      collectMeta('stake', 'Collecting staking rewards')
    )
    expect(state.isCollecting('stake')).toBe(true)
  })

  it('sets a failure when the collect throws', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n)] })
    deps.rewards.collectReward.mockRejectedValueOnce(new Error('nope'))
    await state.collectOne('stake')
    expect(state.failure.value).toEqual({
      message: "Couldn't collect staking rewards: nope",
      timeout: false,
    })
    expect(state.isCollecting('stake')).toBe(false)
  })

  it('ignores a second collect while one runs', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n), entry('pillar', 1n)] })
    let release: (v: { hash: string }) => void = () => {}
    deps.rewards.collectReward.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve))
    )
    const first = state.collectOne('stake')
    await state.collectOne('pillar')
    expect(deps.rewards.collectReward).toHaveBeenCalledTimes(1)
    release({ hash: 'h' })
    await first
  })
})

describe('detail', () => {
  it('describes each source', () => {
    const { deps, state, delegation, stakeEntries, address } = setup()
    expect(state.detail('pillar')).toBe('')
    expect(state.detail('stake')).toBe('')
    expect(state.detail('sentinel')).toBe('Sentinel rewards')
    expect(state.detail('liquidity')).toBe('Liquidity program')

    deps.pillar.delegationFor.value = address
    deps.stake.stakeEntriesFor.value = address
    expect(state.detail('pillar')).toBe('Not delegating')
    expect(state.detail('stake')).toBe('0 active stakes')

    delegation.value = { name: 'Alpha' }
    stakeEntries.value = [{ amount: 1n }]
    expect(state.detail('pillar')).toBe('Delegating to Alpha')
    expect(state.detail('stake')).toBe('1 active stake')
  })
})

describe('retry and empty sources', () => {
  it('collects nothing when no source has rewards', async () => {
    const { deps, state } = setup({ rewards: [] })
    await state.collectAll()
    expect(deps.rewards.collectAll).not.toHaveBeenCalled()
    expect(state.submitting.value).toBe(false)
    expect(state.failure.value).toBeNull()
  })

  it('retries only the sources still collectable after a failure and clears the failure', async () => {
    const { address, deps, state } = setup({ rewards: [entry('stake', 1n), entry('pillar', 2n)] })
    deps.rewards.collectAll.mockResolvedValueOnce({
      collected: [{ type: 'pillar', hash: 'h1' }],
      failed: { type: 'stake', message: 'boom' },
    })
    await state.collectAll()
    deps.rewards.loadRewards.mockClear()
    await state.tryAgain()
    expect(deps.rewards.loadRewards).toHaveBeenCalledWith(address)
    expect(deps.rewards.collectAll).toHaveBeenLastCalledWith(expect.anything(), address, ['stake'])
    expect(state.failure.value).toBeNull()
    expect(state.retryable.value).toBe(false)
  })

  it('collects nothing when the retry finds no rewards for the account', async () => {
    const { deps, state } = setup({ rewards: [entry('stake', 1n)], loadedFor: 'z1other' })
    await state.tryAgain()
    expect(deps.rewards.collectAll).not.toHaveBeenCalled()
  })
})

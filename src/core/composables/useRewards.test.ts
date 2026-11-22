import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAllUncollectedRewards: vi.fn(),
  getRewardHistory: vi.fn(),
  getGenesisTime: vi.fn(),
  createCollectRewardBlock: vi.fn(),
  sendEmbeddedContractBlock: vi.fn(),
  trackTransaction: vi.fn(),
  runActivity: vi.fn(),
}))

vi.mock('../rewards-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('../rewards-service')>()
  return {
    ...original,
    RewardsService: {
      getInstance: () => ({
        getAllUncollectedRewards: mocks.getAllUncollectedRewards,
        getRewardHistory: mocks.getRewardHistory,
        getGenesisTime: mocks.getGenesisTime,
        createCollectRewardBlock: mocks.createCollectRewardBlock,
      }),
    },
  }
})
vi.mock('../transaction-service', () => ({
  TransactionService: {
    getInstance: () => ({ sendEmbeddedContractBlock: mocks.sendEmbeddedContractBlock }),
  },
}))
vi.mock('./useActivity', () => ({ runActivity: mocks.runActivity }))
vi.mock('./useTxTracker', () => ({ trackTransaction: mocks.trackTransaction }))

import { sessionManager } from '../session-manager'
import { collectMeta, collectableSources, useRewards } from './useRewards'

const wallet = { baseAddress: 'z1base', accounts: [{ index: 0, address: 'z1from' }] } as never
const keyPair = { id: 'kp' }
const keyStore = { getKeyPair: () => keyPair } as never

const reward = (type: string, znn: bigint, qsr: bigint = 0n) =>
  ({ type, reward: { znnAmount: znn, qsrAmount: qsr } }) as never
const sentBlock = (hash: string) => ({ hash: { toString: () => hash }, address: 'z1from' })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sessionManager.drop(null)
  sessionManager.attach({ isExpired: () => false, unlocked: () => {}, locked: () => {} })
  sessionManager.unlock('z1base', keyStore)
  mocks.runActivity.mockImplementation(async (_label: string, run: never) =>
    (run as (c: object) => unknown)({ setStep: () => {} })
  )
  mocks.createCollectRewardBlock.mockImplementation((type: string) => ({ block: type }))
  let n = 0
  mocks.sendEmbeddedContractBlock.mockImplementation(async () => sentBlock(`h${++n}`))
})

describe('collectableSources', () => {
  it('keeps sources with a ZNN or QSR amount in collection order', () => {
    const list = [
      reward('liquidity', 0n, 5n),
      reward('sentinel', 0n, 0n),
      reward('pillar', 3n),
      reward('stake', 0n, 0n),
    ]

    expect(collectableSources(list)).toEqual(['pillar', 'liquidity'])
  })

  it('is empty for no rewards', () => {
    expect(collectableSources([])).toEqual([])
  })
})

describe('collectMeta', () => {
  it('describes a contract call with the lower case source label', () => {
    expect(collectMeta('stake', 'Collecting 1 of 2')).toEqual({
      kind: 'contract',
      title: 'Rewards · Collect staking rewards',
      progress: 'Collecting 1 of 2',
    })
  })
})

describe('loadRewards', () => {
  it('sets the rewards and the address they belong to together', async () => {
    mocks.getAllUncollectedRewards.mockResolvedValue([reward('pillar', 1n)])
    const rewards = useRewards()

    await rewards.loadRewards('z1a')

    expect(rewards.rewards.value).toHaveLength(1)
    expect(rewards.rewardsFor.value).toBe('z1a')
  })

  it('clears the list and address for no address', async () => {
    mocks.getAllUncollectedRewards.mockResolvedValue([reward('pillar', 1n)])
    const rewards = useRewards()
    await rewards.loadRewards('z1a')

    await rewards.loadRewards(null)

    expect(rewards.rewards.value).toEqual([])
    expect(rewards.rewardsFor.value).toBeNull()
  })

  it('keeps the newest load when an older one resolves last', async () => {
    const first = deferred<unknown[]>()
    mocks.getAllUncollectedRewards
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([reward('stake', 2n)])
    const rewards = useRewards()

    const a = rewards.loadRewards('z1a')
    await rewards.loadRewards('z1b')
    first.resolve([reward('pillar', 1n)])
    await a

    expect(rewards.rewardsFor.value).toBe('z1b')
    expect(rewards.rewards.value).toHaveLength(1)
    expect((rewards.rewards.value[0] as { type: string }).type).toBe('stake')
  })

  it('ignores an older failure after a newer load', async () => {
    const first = deferred<unknown[]>()
    mocks.getAllUncollectedRewards
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([reward('stake', 2n)])
    const rewards = useRewards()

    const a = rewards.loadRewards('z1a')
    await rewards.loadRewards('z1b')
    first.reject(new Error('boom'))
    await a

    expect(rewards.rewardsFor.value).toBe('z1b')
    expect(rewards.error.value).toBeNull()
  })

  it('drops a response that lands after the address was cleared', async () => {
    const first = deferred<unknown[]>()
    mocks.getAllUncollectedRewards.mockReturnValueOnce(first.promise)
    const rewards = useRewards()

    const a = rewards.loadRewards('z1a')
    await rewards.loadRewards(null)
    first.resolve([reward('pillar', 1n)])
    await a

    expect(rewards.rewards.value).toEqual([])
    expect(rewards.rewardsFor.value).toBeNull()
  })

  it('clears the address and sets the error on failure', async () => {
    mocks.getAllUncollectedRewards.mockResolvedValueOnce([reward('pillar', 1n)])
    const rewards = useRewards()
    await rewards.loadRewards('z1a')
    mocks.getAllUncollectedRewards.mockRejectedValueOnce(new Error('offline'))

    await rewards.loadRewards('z1a')

    expect(rewards.rewardsFor.value).toBeNull()
    expect(rewards.rewards.value).toEqual([])
    expect(rewards.error.value).toBe('offline')
    expect(rewards.isLoading.value).toBe(false)
  })
})

describe('loadHistory', () => {
  const rows = [{ epoch: 1 }]

  it('stores the history, its address and the genesis time', async () => {
    mocks.getRewardHistory.mockResolvedValue(rows)
    mocks.getGenesisTime.mockResolvedValue(1234)
    const rewards = useRewards()

    await rewards.loadHistory('z1a')

    expect(rewards.history.value).toEqual(rows)
    expect(rewards.historyFor.value).toBe('z1a')
    expect(rewards.genesisAt.value).toBe(1234)
    expect(rewards.historyError.value).toBeNull()
    expect(rewards.isLoadingHistory.value).toBe(false)
  })

  it('shows the history without dates when only the genesis read fails', async () => {
    mocks.getRewardHistory.mockResolvedValue(rows)
    mocks.getGenesisTime.mockRejectedValue(new Error('no genesis'))
    const rewards = useRewards()

    await rewards.loadHistory('z1a')

    expect(rewards.history.value).toEqual(rows)
    expect(rewards.genesisAt.value).toBeNull()
    expect(rewards.historyError.value).toBeNull()
  })

  it('clears the chart and sets the error when the history read fails', async () => {
    mocks.getRewardHistory.mockResolvedValue(rows)
    mocks.getGenesisTime.mockResolvedValue(1)
    const rewards = useRewards()
    await rewards.loadHistory('z1a')
    mocks.getRewardHistory.mockRejectedValue(new Error('node'))

    await rewards.loadHistory('z1a')

    expect(rewards.history.value).toEqual([])
    expect(rewards.historyFor.value).toBeNull()
    expect(rewards.historyError.value).toBe("Couldn't load reward history from the node.")
    expect(rewards.isLoadingHistory.value).toBe(false)
  })

  it('ignores a response that is not the latest and stays loading for the latest', async () => {
    const first = deferred<unknown[]>()
    const second = deferred<unknown[]>()
    mocks.getRewardHistory
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    mocks.getGenesisTime.mockResolvedValue(1)
    const rewards = useRewards()

    const a = rewards.loadHistory('z1a')
    const b = rewards.loadHistory('z1b')
    first.resolve([{ epoch: 1 }])
    await a

    expect(rewards.historyFor.value).toBeNull()
    expect(rewards.isLoadingHistory.value).toBe(true)

    second.resolve([{ epoch: 2 }])
    await b

    expect(rewards.historyFor.value).toBe('z1b')
    expect(rewards.history.value).toEqual([{ epoch: 2 }])
    expect(rewards.isLoadingHistory.value).toBe(false)
  })
})

describe('collectReward', () => {
  it('sends with a context carrying the account and tracks the block', async () => {
    const meta = collectMeta('pillar', 'Collecting')
    const rewards = useRewards()

    const block = await rewards.collectReward(wallet, 'z1from', 'pillar', meta)

    expect(block.hash.toString()).toBe('h1')
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'pillar' },
      keyPair,
      undefined,
      { ...meta, from: 'z1from' }
    )
    expect(mocks.trackTransaction).toHaveBeenCalledWith(meta.title, block, meta)
  })

  it('sends no context and keeps the default tracker label without meta', async () => {
    const rewards = useRewards()

    const block = await rewards.collectReward(wallet, 'z1from', 'stake')

    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'stake' },
      keyPair,
      undefined,
      undefined
    )
    expect(mocks.trackTransaction).toHaveBeenCalledWith('Collect stake rewards', block, undefined)
  })

  it('throws the locked message and signs nothing when the session is gone', async () => {
    sessionManager.drop(null)
    const rewards = useRewards()

    await expect(rewards.collectReward(wallet, 'z1from', 'pillar')).rejects.toThrow(
      'Wallet is locked. Please unlock it first.'
    )

    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(rewards.isCollecting.value).toBe(false)
  })

  it('throws for an account that is not in the wallet', async () => {
    const rewards = useRewards()

    await expect(rewards.collectReward(wallet, 'z1other', 'pillar')).rejects.toThrow(
      'Account not found'
    )
    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
  })
})

describe('collectAll', () => {
  it('collects in source order whatever order was passed, with progress text', async () => {
    const rewards = useRewards()

    const result = await rewards.collectAll(wallet, 'z1from', ['liquidity', 'pillar', 'stake'])

    expect(mocks.createCollectRewardBlock.mock.calls.map((c) => c[0])).toEqual([
      'pillar',
      'stake',
      'liquidity',
    ])
    expect(result.failed).toBeNull()
    expect(result.collected).toEqual([
      { type: 'pillar', hash: 'h1' },
      { type: 'stake', hash: 'h2' },
      { type: 'liquidity', hash: 'h3' },
    ])
    const contexts = mocks.sendEmbeddedContractBlock.mock.calls.map((c) => c[3])
    expect(contexts.map((c) => c.progress)).toEqual([
      'Collecting 1 of 3',
      'Collecting 2 of 3',
      'Collecting 3 of 3',
    ])
    for (const context of contexts) {
      expect(context).toMatchObject({ kind: 'contract', from: 'z1from' })
    }
  })

  it('collects only the sources it is given', async () => {
    const rewards = useRewards()

    await rewards.collectAll(wallet, 'z1from', ['sentinel'])

    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledTimes(1)
    expect(mocks.createCollectRewardBlock).toHaveBeenCalledWith('sentinel')
  })

  it('stops at the first failure and reports what was collected', async () => {
    mocks.sendEmbeddedContractBlock
      .mockResolvedValueOnce(sentBlock('a'))
      .mockRejectedValueOnce(new Error('rejected by node'))
    const rewards = useRewards()

    const result = await rewards.collectAll(wallet, 'z1from', ['pillar', 'stake', 'sentinel'])

    expect(result.collected).toEqual([{ type: 'pillar', hash: 'a' }])
    expect(result.failed).toEqual({ type: 'stake', message: 'rejected by node' })
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledTimes(2)
  })

  it('uses the fallback message for an error without one', async () => {
    mocks.sendEmbeddedContractBlock.mockRejectedValueOnce('weird')
    const rewards = useRewards()

    const result = await rewards.collectAll(wallet, 'z1from', ['pillar'])

    expect(result.failed).toEqual({ type: 'pillar', message: 'Failed to collect reward' })
  })

  it('reports a locked wallet as a failure of the first source and never throws', async () => {
    sessionManager.drop(null)
    const rewards = useRewards()

    const result = await rewards.collectAll(wallet, 'z1from', ['pillar', 'stake'])

    expect(result.collected).toEqual([])
    expect(result.failed).toEqual({
      type: 'pillar',
      message: 'Wallet is locked. Please unlock it first.',
    })
  })

  it('returns an empty result for no sources', async () => {
    const rewards = useRewards()

    expect(await rewards.collectAll(wallet, 'z1from', [])).toEqual({ collected: [], failed: null })
  })

  it('does not read or write the loaded rewards', async () => {
    mocks.getAllUncollectedRewards.mockResolvedValue([reward('pillar', 1n)])
    const rewards = useRewards()
    await rewards.loadRewards('z1from')
    mocks.getAllUncollectedRewards.mockClear()

    await rewards.collectAll(wallet, 'z1from', ['pillar'])

    expect(mocks.getAllUncollectedRewards).not.toHaveBeenCalled()
    expect(rewards.rewards.value).toHaveLength(1)
    expect(rewards.rewardsFor.value).toBe('z1from')
  })

  it('collects only what is left when called again with the remaining sources', async () => {
    mocks.sendEmbeddedContractBlock
      .mockResolvedValueOnce(sentBlock('a'))
      .mockRejectedValueOnce(new Error('x'))
    const rewards = useRewards()
    const first = await rewards.collectAll(wallet, 'z1from', ['pillar', 'stake', 'sentinel'])
    mocks.createCollectRewardBlock.mockClear()

    const left = collectableSources([reward('stake', 1n), reward('sentinel', 1n)])
    const second = await rewards.collectAll(wallet, 'z1from', left)

    expect(first.failed?.type).toBe('stake')
    expect(mocks.createCollectRewardBlock.mock.calls.map((c) => c[0])).toEqual([
      'stake',
      'sentinel',
    ])
    expect(second.failed).toBeNull()
  })
})

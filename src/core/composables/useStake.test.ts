import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getStakeEntries: vi.fn(),
  createStakeBlock: vi.fn(),
  createCancelStakeBlock: vi.fn(),
  sendEmbeddedContractBlock: vi.fn(),
  trackTransaction: vi.fn(),
}))

vi.mock('../stake-service', () => ({
  StakeService: {
    getInstance: () => ({
      getStakeEntries: mocks.getStakeEntries,
      createStakeBlock: mocks.createStakeBlock,
      createCancelStakeBlock: mocks.createCancelStakeBlock,
    }),
  },
}))
vi.mock('../transaction-service', () => ({
  TransactionService: {
    getInstance: () => ({ sendEmbeddedContractBlock: mocks.sendEmbeddedContractBlock }),
  },
}))
vi.mock('./useActivity', () => ({
  runActivity: async (_label: string, run: (c: object) => unknown) =>
    run({ setStep: () => {} }),
}))
vi.mock('./useTxTracker', () => ({ trackTransaction: mocks.trackTransaction }))

import { sessionManager } from '../session-manager'
import { useStake } from './useStake'

const wallet = { baseAddress: 'z1base', accounts: [{ index: 0, address: 'z1from' }] } as never
const keyPair = { id: 'kp' }
const keyStore = { getKeyPair: () => keyPair } as never
const meta = { kind: 'contract', title: 'Staking · Stake 5 ZNN', progress: 'Staking' } as never
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
  mocks.createStakeBlock.mockReturnValue({ block: 'stake' })
  mocks.createCancelStakeBlock.mockReturnValue({ block: 'cancel' })
  mocks.sendEmbeddedContractBlock.mockResolvedValue(sentBlock('h1'))
})

describe('loadStakeEntries', () => {
  it('sets the list and the address it belongs to together', async () => {
    mocks.getStakeEntries.mockResolvedValue({ list: [{ id: 'a' }] })
    const stake = useStake()

    await stake.loadStakeEntries('z1a')

    expect(stake.stakeEntries.value).toEqual([{ id: 'a' }])
    expect(stake.stakeEntriesFor.value).toBe('z1a')
  })

  it('clears the address for no address', async () => {
    mocks.getStakeEntries.mockResolvedValue({ list: [{ id: 'a' }] })
    const stake = useStake()
    await stake.loadStakeEntries('z1a')

    await stake.loadStakeEntries('')

    expect(stake.stakeEntries.value).toEqual([])
    expect(stake.stakeEntriesFor.value).toBeNull()
  })

  it('keeps the newest load when an older one resolves last', async () => {
    const first = deferred<{ list: unknown[] }>()
    mocks.getStakeEntries
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ list: [{ id: 'b' }] })
    const stake = useStake()

    const a = stake.loadStakeEntries('z1a')
    await stake.loadStakeEntries('z1b')
    first.resolve({ list: [{ id: 'a' }] })
    await a

    expect(stake.stakeEntriesFor.value).toBe('z1b')
    expect(stake.stakeEntries.value).toEqual([{ id: 'b' }])
  })

  it('ignores an older failure after a newer load', async () => {
    const first = deferred<{ list: unknown[] }>()
    mocks.getStakeEntries
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ list: [{ id: 'b' }] })
    const stake = useStake()

    const a = stake.loadStakeEntries('z1a')
    await stake.loadStakeEntries('z1b')
    first.reject(new Error('boom'))
    await a

    expect(stake.stakeEntriesFor.value).toBe('z1b')
    expect(stake.error.value).toBeNull()
  })

  it('clears the address on failure', async () => {
    mocks.getStakeEntries.mockResolvedValueOnce({ list: [{ id: 'a' }] })
    const stake = useStake()
    await stake.loadStakeEntries('z1a')
    mocks.getStakeEntries.mockRejectedValueOnce(new Error('offline'))

    await stake.loadStakeEntries('z1a')

    expect(stake.stakeEntriesFor.value).toBeNull()
    expect(stake.error.value).toBe('offline')
    expect(stake.isLoading.value).toBe(false)
  })
})

describe('stakeZnn', () => {
  it('builds the block from the duration and amount, sends with a context and returns it', async () => {
    const block = await useStake().stakeZnn(wallet, 'z1from', 2_592_000, 500000000n, meta)

    expect(mocks.createStakeBlock).toHaveBeenCalledWith(2_592_000, 500000000n)
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'stake' },
      keyPair,
      undefined,
      { ...(meta as object), from: 'z1from' }
    )
    expect(block.hash.toString()).toBe('h1')
    expect(mocks.trackTransaction).toHaveBeenCalledWith(
      (meta as { title: string }).title,
      block,
      meta
    )
  })

  it('keeps the default label and sends no context without meta', async () => {
    await useStake().stakeZnn(wallet, 'z1from', 1, 100000000n)

    expect(mocks.trackTransaction.mock.calls[0][0]).toBe('Stake ZNN')
    expect(mocks.sendEmbeddedContractBlock.mock.calls[0][3]).toBeUndefined()
  })

  it('signs nothing when the wallet is locked', async () => {
    sessionManager.drop(null)
    const stake = useStake()

    await expect(stake.stakeZnn(wallet, 'z1from', 1, 100000000n, meta)).rejects.toThrow(
      'Wallet is locked. Please unlock it first.'
    )

    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(stake.isStaking.value).toBe(false)
  })
})

describe('cancelStake', () => {
  it('cancels by id, sends with a context and returns the block', async () => {
    const cancelMeta = { kind: 'contract', title: 'Staking · Cancel stake', progress: 'x' } as never

    const block = await useStake().cancelStake(wallet, 'z1from', 'abc', cancelMeta)

    expect(mocks.createCancelStakeBlock).toHaveBeenCalledWith('abc')
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'cancel' },
      keyPair,
      undefined,
      { ...(cancelMeta as object), from: 'z1from' }
    )
    expect(block.hash.toString()).toBe('h1')
  })

  it('keeps the default label without meta', async () => {
    await useStake().cancelStake(wallet, 'z1from', 'abc')

    expect(mocks.trackTransaction.mock.calls[0][0]).toBe('Cancel stake')
  })

  it('sets the error and clears the busy state when the node rejects', async () => {
    mocks.sendEmbeddedContractBlock.mockRejectedValueOnce(new Error('rejected'))
    const stake = useStake()

    await expect(stake.cancelStake(wallet, 'z1from', 'abc')).rejects.toThrow('rejected')

    expect(stake.error.value).toBe('rejected')
    expect(stake.isCanceling.value).toBe(false)
    expect(stake.cancelingStakeId.value).toBeNull()
  })
})

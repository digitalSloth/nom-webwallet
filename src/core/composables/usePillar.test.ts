import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getDelegatedPillar: vi.fn(),
  createUndelegateBlock: vi.fn(),
  createDelegateBlock: vi.fn(),
  sendEmbeddedContractBlock: vi.fn(),
  trackTransaction: vi.fn(),
}))

vi.mock('../pillar-service', () => ({
  PillarService: {
    getInstance: () => ({
      createUndelegateBlock: mocks.createUndelegateBlock,
      createDelegateBlock: mocks.createDelegateBlock,
    }),
  },
}))
vi.mock('../account-service', () => ({
  AccountService: { getInstance: () => ({ getDelegatedPillar: mocks.getDelegatedPillar }) },
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
import { usePillar } from './usePillar'

const wallet = { baseAddress: 'z1base', accounts: [{ index: 0, address: 'z1from' }] } as never
const keyPair = { id: 'kp' }
const keyStore = { getKeyPair: () => keyPair } as never
const meta = { kind: 'contract', title: 'Pillars · Delegate to P', progress: 'Delegating' } as never
const sentBlock = (hash: string) => ({ hash: { toString: () => hash }, address: 'z1from' })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionManager.drop(null)
  sessionManager.attach({ isExpired: () => false, unlocked: () => {}, locked: () => {} })
  sessionManager.unlock('z1base', keyStore)
  mocks.createUndelegateBlock.mockReturnValue({ block: 'undelegate' })
  mocks.createDelegateBlock.mockImplementation((name: string) => ({ block: `delegate:${name}` }))
  let n = 0
  mocks.sendEmbeddedContractBlock.mockImplementation(async () => sentBlock(`h${++n}`))
})

describe('loadDelegation', () => {
  it('stores the pillar name, the raw weight and the address', async () => {
    mocks.getDelegatedPillar.mockResolvedValue({ name: 'Alpha', weight: 150000000n })
    const pillar = usePillar()

    await pillar.loadDelegation('z1a')

    expect(pillar.delegation.value).toEqual({ name: 'Alpha', weight: '150000000' })
    expect(pillar.delegationFor.value).toBe('z1a')
  })

  it.each([
    ['a null result', null],
    ['an empty name', { name: '', weight: 0n }],
  ])('stores no delegation for %s', async (_case, info) => {
    mocks.getDelegatedPillar.mockResolvedValue(info)
    const pillar = usePillar()

    await pillar.loadDelegation('z1a')

    expect(pillar.delegation.value).toBeNull()
    expect(pillar.delegationFor.value).toBe('z1a')
  })

  it('keeps the newest load when an older one resolves last', async () => {
    const first = deferred<unknown>()
    mocks.getDelegatedPillar
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ name: 'Beta', weight: 2n })
    const pillar = usePillar()

    const a = pillar.loadDelegation('z1a')
    await pillar.loadDelegation('z1b')
    first.resolve({ name: 'Alpha', weight: 1n })
    await a

    expect(pillar.delegationFor.value).toBe('z1b')
    expect(pillar.delegation.value).toEqual({ name: 'Beta', weight: '2' })
  })
})

describe('undelegate', () => {
  it('sends the undelegate block with a context carrying the account', async () => {
    const pillar = usePillar()

    const block = await pillar.undelegate(wallet, 'z1from', meta)

    expect(block.hash.toString()).toBe('h1')
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'undelegate' },
      keyPair,
      undefined,
      { ...(meta as object), from: 'z1from' }
    )
    expect(mocks.trackTransaction).toHaveBeenCalledWith(
      (meta as { title: string }).title,
      block,
      meta
    )
    expect(pillar.isDelegating.value).toBe(false)
  })

  it('defaults the tracker label to Undelegate without meta', async () => {
    await usePillar().undelegate(wallet, 'z1from')

    expect(mocks.trackTransaction.mock.calls[0][0]).toBe('Undelegate')
    expect(mocks.sendEmbeddedContractBlock.mock.calls[0][3]).toBeUndefined()
  })

  it('signs nothing and sets the error when the wallet is locked', async () => {
    sessionManager.drop(null)
    const pillar = usePillar()

    await expect(pillar.undelegate(wallet, 'z1from', meta)).rejects.toThrow(
      'Wallet is locked. Please unlock it first.'
    )

    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(pillar.error.value).toBe('Wallet is locked. Please unlock it first.')
    expect(pillar.isDelegating.value).toBe(false)
  })
})

describe('delegateToPillar', () => {
  it('returns the delegate block and sends it with a context', async () => {
    const block = await usePillar().delegateToPillar(wallet, 'z1from', 'Alpha', false, meta)

    expect(block.hash.toString()).toBe('h1')
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(
      { block: 'delegate:Alpha' },
      keyPair,
      undefined,
      { ...(meta as object), from: 'z1from' }
    )
    expect(mocks.trackTransaction).toHaveBeenCalledWith(
      (meta as { title: string }).title,
      block,
      meta
    )
  })

  it('defaults the tracker label to the pillar name without meta', async () => {
    await usePillar().delegateToPillar(wallet, 'z1from', 'Alpha')

    expect(mocks.trackTransaction.mock.calls[0][0]).toBe('Delegate to Alpha')
  })

  it('undelegates first without a context and delegates with one when asked to', async () => {
    const block = await usePillar().delegateToPillar(wallet, 'z1from', 'Beta', true, meta)

    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledTimes(2)
    const [undelegateCall, delegateCall] = mocks.sendEmbeddedContractBlock.mock.calls
    expect(undelegateCall[0]).toEqual({ block: 'undelegate' })
    expect(undelegateCall[3]).toBeUndefined()
    expect(delegateCall[0]).toEqual({ block: 'delegate:Beta' })
    expect(delegateCall[3]).toEqual({ ...(meta as object), from: 'z1from' })
    expect(block.hash.toString()).toBe('h2')
  })

  it('does not delegate when the undelegate step fails', async () => {
    mocks.sendEmbeddedContractBlock.mockRejectedValueOnce(new Error('rejected'))
    const pillar = usePillar()

    await expect(pillar.delegateToPillar(wallet, 'z1from', 'Beta', true, meta)).rejects.toThrow(
      'rejected'
    )

    expect(mocks.createDelegateBlock).not.toHaveBeenCalled()
    expect(pillar.error.value).toBe('rejected')
  })
})

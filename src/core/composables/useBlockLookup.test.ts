import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PLASMA_ADDRESS, type AccountBlock } from 'znn-typescript-sdk'

const mocks = vi.hoisted(() => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
  getAccountBlock: vi.fn(),
  set: vi.fn(),
}))

vi.mock('nom-ui', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('../transaction-service', () => ({
  TransactionService: { getInstance: () => ({ getAccountBlock: mocks.getAccountBlock }) },
}))
vi.mock('../storage/storage-service', () => ({
  storageService: { get: async () => null, set: mocks.set },
}))

import { useTrackedTransactions } from './useTxTracker'
import { useBlockLookup } from './useBlockLookup'

const OWN = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'
const OTHER = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'
const HASH = 'a'.repeat(64)
const USER_SEND = 2
const USER_RECEIVE = 3
const CONTRACT_SEND = 4
const CONTRACT_RECEIVE = 5

function block(over: Record<string, unknown> = {}): AccountBlock {
  return {
    blockType: USER_SEND,
    hash: { toString: () => HASH },
    height: 7,
    address: { toString: () => OWN },
    toAddress: { toString: () => OTHER, core: new Uint8Array([0]) },
    amount: 150n,
    token: { symbol: 'ZNN', decimals: 8 },
    data: new Uint8Array(),
    confirmationDetail: { momentumTimestamp: 1_700_000_000, momentumHeight: 77 },
    descendantBlocks: [],
    ...over,
  } as unknown as AccountBlock
}

describe('useBlockLookup', () => {
  beforeEach(() => {
    mocks.getAccountBlock.mockReset()
    mocks.set.mockReset()
    Object.values(mocks.toast).forEach((fn) => fn.mockReset())
  })

  it('gives null for a missing block', async () => {
    mocks.getAccountBlock.mockResolvedValue(null)

    expect(await useBlockLookup().lookup(HASH)).toBeNull()
  })

  it('reports a confirmed user send with a paired block as received with one read', async () => {
    mocks.getAccountBlock.mockResolvedValue(
      block({ pairedAccountBlock: block({ blockType: USER_RECEIVE }) })
    )

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry).toMatchObject({
      stage: { kind: 'received', momentum: 77 },
      done: true,
      tx: {
        hash: HASH,
        label: 'Sent',
        address: OWN,
        publishedAt: 1_700_000_000_000,
        meta: {
          kind: 'send',
          title: 'Sent',
          amount: '150',
          decimals: 8,
          symbol: 'ZNN',
          recipient: OTHER,
        },
      },
    })
    expect(mocks.getAccountBlock).toHaveBeenCalledTimes(1)
    expect(mocks.getAccountBlock).toHaveBeenCalledWith(HASH)
  })

  it('reports a send without a paired block as awaiting the recipient', async () => {
    mocks.getAccountBlock.mockResolvedValue(block())

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.stage).toEqual({ kind: 'awaitingRecipient', momentum: 77 })
  })

  it('reports an unconfirmed block as published', async () => {
    mocks.getAccountBlock.mockResolvedValue(block({ confirmationDetail: undefined }))

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.stage).toEqual({ kind: 'published' })
    expect(entry?.done).toBe(true)
  })

  it('reads the follow-on blocks of an executed contract call through getAccountBlock', async () => {
    const followOn = 'b'.repeat(64)
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]),
      descendantBlocks: [{ hash: { toString: () => followOn } }],
    })
    const root = block({
      blockType: CONTRACT_SEND,
      toAddress: { toString: () => OTHER, core: new Uint8Array([1]) },
      pairedAccountBlock: paired,
    })
    mocks.getAccountBlock.mockImplementation(async (hash: string) =>
      hash === followOn ? block({ confirmationDetail: undefined }) : root
    )

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.stage).toEqual({ kind: 'executed', pendingFollowOns: 1 })
    expect(mocks.getAccountBlock).toHaveBeenCalledWith(followOn)
    expect(mocks.getAccountBlock.mock.calls.filter(([h]) => h === HASH)).toHaveLength(1)
  })

  it('labels a call to an embedded contract and sets the contract kind', async () => {
    mocks.getAccountBlock.mockResolvedValue(
      block({ blockType: CONTRACT_SEND, toAddress: PLASMA_ADDRESS })
    )

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.tx.label).toBe('Contract call')
    expect(entry?.tx.meta?.kind).toBe('contract')
  })

  it('maps an incoming block to a receive without a recipient', async () => {
    const paired = block({
      address: { toString: () => OTHER },
      toAddress: { toString: () => OWN, core: new Uint8Array([0]) },
      amount: 999n,
      token: { symbol: 'QSR', decimals: 8 },
    })
    mocks.getAccountBlock.mockResolvedValue(
      block({ blockType: USER_RECEIVE, amount: 0n, token: null, pairedAccountBlock: paired })
    )

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.tx.label).toBe('Received')
    expect(entry?.tx.meta).toMatchObject({ kind: 'receive', amount: '999', symbol: 'QSR' })
    expect(entry?.tx.meta).not.toHaveProperty('recipient')
  })

  it('omits the symbol when the token is unknown', async () => {
    mocks.getAccountBlock.mockResolvedValue(block({ token: undefined }))

    const entry = await useBlockLookup().lookup(HASH)

    expect(entry?.tx.meta).not.toHaveProperty('symbol')
  })

  it('rejects with the node error', async () => {
    mocks.getAccountBlock.mockRejectedValue(new Error('node down'))

    await expect(useBlockLookup().lookup(HASH)).rejects.toThrow('node down')
  })

  it('never tracks, stores or announces the block', async () => {
    mocks.getAccountBlock.mockResolvedValue(
      block({ pairedAccountBlock: block({ blockType: USER_RECEIVE }) })
    )

    await useBlockLookup().lookup(HASH)

    expect(useTrackedTransactions().get(HASH)).toBeNull()
    expect(useTrackedTransactions().entries.value).toEqual([])
    expect(mocks.set).not.toHaveBeenCalled()
    for (const fn of Object.values(mocks.toast)) expect(fn).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ chainId: 1 }))

vi.mock('znn-typescript-sdk', () => ({
  AccountBlockTemplate: class {},
  Address: { parse: (value: string) => `addr:${value}` },
  Zenon: { getChainIdentifier: () => mocks.chainId },
}))
vi.mock('./zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))

import { REWARD_TYPES, RewardsService, epochStart } from './rewards-service'

type Entry = { epoch: number; znnAmount: bigint; qsrAmount: bigint }
const entry = (epoch: number, znn: bigint, qsr: bigint = 0n): Entry => ({
  epoch,
  znnAmount: znn,
  qsrAmount: qsr,
})

function build(pages: Partial<Record<'pillar' | 'stake' | 'sentinel' | 'liquidity', Entry[]>>) {
  const source = (name: keyof typeof pages) => ({
    getFrontierRewardByPage: vi.fn(
      async (): Promise<{ list?: Entry[] }> => ({
        list: pages[name] ?? [],
      })
    ),
  })
  const embedded = {
    pillar: source('pillar'),
    stake: source('stake'),
    sentinel: source('sentinel'),
    liquidity: source('liquidity'),
  }
  const ledger = { getMomentumsByHeight: vi.fn() }
  const ensureInitialized = vi.fn(async () => {})
  const service = new RewardsService({
    getZenon: () => ({ embedded, ledger }) as never,
    ensureInitialized,
  })
  return { service, embedded, ledger, ensureInitialized }
}

beforeEach(() => {
  mocks.chainId = 1
})

describe('epochStart', () => {
  it('adds whole 24 hour epochs to the genesis time', () => {
    expect(epochStart(0, 1_000)).toBe(1_000)
    expect(epochStart(3, 1_000)).toBe(1_000 + 3 * 86_400)
  })
})

describe('REWARD_TYPES', () => {
  it('fixes the collection and display order', () => {
    expect([...REWARD_TYPES]).toEqual(['pillar', 'stake', 'sentinel', 'liquidity'])
  })
})

describe('getRewardHistory', () => {
  it.each([1e20, Infinity, NaN, -1, 1.5])('ignores the unsafe node epoch %s', async (bad) => {
    const { service } = build({ pillar: [entry(10, 5n), entry(bad, 9n)] })
    // An unbounded window loop would never return, so cap the rows it may create.
    const realSet = Map.prototype.set
    let rows = 0
    const spy = vi.spyOn(Map.prototype, 'set').mockImplementation(function (
      this: Map<unknown, unknown>,
      k,
      v
    ) {
      if (++rows > 1_000) throw new Error('epoch window is unbounded')
      return realSet.call(this, k, v)
    })

    let history
    try {
      history = await service.getRewardHistory('z1x')
    } finally {
      spy.mockRestore()
    }

    expect(history).toHaveLength(11)
    expect(history[10]).toMatchObject({ epoch: 10, znn: { pillar: '5' } })
  })

  it('asks every source for page 0 of the requested epochs', async () => {
    const { service, embedded, ensureInitialized } = build({})

    await service.getRewardHistory('z1a', 12)

    expect(ensureInitialized).toHaveBeenCalled()
    for (const source of Object.values(embedded)) {
      expect(source.getFrontierRewardByPage).toHaveBeenCalledWith('addr:z1a', 0, 12)
    }
  })

  it('returns an empty list when no source has entries', async () => {
    const { service } = build({})

    expect(await service.getRewardHistory('z1a')).toEqual([])
  })

  it('builds one zeroed row per epoch up to the newest, ascending, and sums per source', async () => {
    const { service } = build({
      pillar: [entry(12, 5n, 1n), entry(10, 3n)],
      stake: [entry(11, 7n, 9n)],
    })

    const history = await service.getRewardHistory('z1a', 3)

    expect(history.map((r) => r.epoch)).toEqual([10, 11, 12])
    expect(history[0].znn).toEqual({ pillar: '3', stake: '0', sentinel: '0', liquidity: '0' })
    expect(history[1].znn.stake).toBe('7')
    expect(history[1].qsr.stake).toBe('9')
    expect(history[2].znn.pillar).toBe('5')
    expect(history[2].qsr.pillar).toBe('1')
  })

  it('sums several entries of one epoch and source without precision loss', async () => {
    const big = 9_007_199_254_740_993n
    const { service } = build({ sentinel: [entry(4, big), entry(4, 2n)] })

    const history = await service.getRewardHistory('z1a', 1)

    expect(history).toHaveLength(1)
    expect(history[0].znn.sentinel).toBe((big + 2n).toString())
  })

  it('does not depend on the order the node returns entries in', async () => {
    const entries = [entry(3, 1n), entry(9, 2n), entry(5, 3n)]
    const ascending = build({ pillar: [...entries].sort((a, b) => a.epoch - b.epoch) })
    const descending = build({ pillar: [...entries].sort((a, b) => b.epoch - a.epoch) })

    expect(await descending.service.getRewardHistory('z1a')).toEqual(
      await ascending.service.getRewardHistory('z1a')
    )
  })

  it('keeps a window of the last `epochs` epochs and drops older entries', async () => {
    const { service } = build({ pillar: [entry(100, 1n), entry(71, 2n), entry(70, 4n)] })

    const history = await service.getRewardHistory('z1a', 30)

    expect(history).toHaveLength(30)
    expect(history[0].epoch).toBe(71)
    expect(history[29].epoch).toBe(100)
    expect(history[0].znn.pillar).toBe('2')
    expect(history.some((r) => r.epoch === 70)).toBe(false)
  })

  it('never starts the window below epoch 0', async () => {
    const { service } = build({ pillar: [entry(2, 1n)] })

    const history = await service.getRewardHistory('z1a', 30)

    expect(history.map((r) => r.epoch)).toEqual([0, 1, 2])
  })

  it('rejects the whole call when one source fails', async () => {
    const { service, embedded } = build({ pillar: [entry(1, 1n)] })
    embedded.liquidity.getFrontierRewardByPage.mockRejectedValue(new Error('node down'))

    await expect(service.getRewardHistory('z1a')).rejects.toThrow('node down')
  })

  it('treats a missing list as empty', async () => {
    const { service, embedded } = build({ pillar: [entry(1, 1n)] })
    embedded.stake.getFrontierRewardByPage.mockResolvedValue({})

    expect((await service.getRewardHistory('z1a')).map((r) => r.epoch)).toEqual([0, 1])
  })
})

describe('getGenesisTime', () => {
  it('reads momentum 1 and returns its timestamp', async () => {
    const { service, ledger } = build({})
    ledger.getMomentumsByHeight.mockResolvedValue({ list: [{ timestamp: 1_637_000_000 }] })

    expect(await service.getGenesisTime()).toBe(1_637_000_000)
    expect(ledger.getMomentumsByHeight).toHaveBeenCalledWith(1, 1)
  })

  it('caches per chain id and reads again for another chain', async () => {
    const { service, ledger } = build({})
    ledger.getMomentumsByHeight
      .mockResolvedValueOnce({ list: [{ timestamp: 100 }] })
      .mockResolvedValueOnce({ list: [{ timestamp: 200 }] })

    expect(await service.getGenesisTime()).toBe(100)
    expect(await service.getGenesisTime()).toBe(100)
    expect(ledger.getMomentumsByHeight).toHaveBeenCalledTimes(1)

    mocks.chainId = 3
    expect(await service.getGenesisTime()).toBe(200)
    mocks.chainId = 1
    expect(await service.getGenesisTime()).toBe(100)
    expect(ledger.getMomentumsByHeight).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['no momentum', { list: [] }],
    ['no list', {}],
    ['zero timestamp', { list: [{ timestamp: 0 }] }],
    ['negative timestamp', { list: [{ timestamp: -5 }] }],
    ['NaN timestamp', { list: [{ timestamp: Number.NaN }] }],
    ['string timestamp', { list: [{ timestamp: '100' }] }],
  ])('throws on %s and caches nothing', async (_name, response) => {
    const { service, ledger } = build({})
    ledger.getMomentumsByHeight.mockResolvedValueOnce(response)

    await expect(service.getGenesisTime()).rejects.toThrow('The node returned no genesis momentum.')

    ledger.getMomentumsByHeight.mockResolvedValueOnce({ list: [{ timestamp: 55 }] })
    expect(await service.getGenesisTime()).toBe(55)
  })

  it('does not cache a node failure', async () => {
    const { service, ledger } = build({})
    ledger.getMomentumsByHeight.mockRejectedValueOnce(new Error('offline'))

    await expect(service.getGenesisTime()).rejects.toThrow('offline')

    ledger.getMomentumsByHeight.mockResolvedValueOnce({ list: [{ timestamp: 9 }] })
    expect(await service.getGenesisTime()).toBe(9)
  })
})

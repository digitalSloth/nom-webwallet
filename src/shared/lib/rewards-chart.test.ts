import { describe, expect, it } from 'vitest'
import type { RewardEpoch } from '@/core/rewards-service'
import {
  axisTicks,
  chartBars,
  chartSources,
  epochLabel,
  epochMax,
  nextFocus,
} from './rewards-chart'

const row = (
  epoch: number,
  znn: Partial<RewardEpoch['znn']> = {},
  qsr: Partial<RewardEpoch['qsr']> = {}
): RewardEpoch => ({
  epoch,
  znn: { pillar: '0', stake: '0', sentinel: '0', liquidity: '0', ...znn },
  qsr: { pillar: '0', stake: '0', sentinel: '0', liquidity: '0', ...qsr },
})

describe('axisTicks', () => {
  it.each([
    [0, [0, 1, 2, 3, 4]],
    [-3, [0, 1, 2, 3, 4]],
    [0.55, [0, 0.2, 0.4, 0.6, 0.8]],
    [8, [0, 2, 4, 6, 8]],
    [10, [0, 2.5, 5, 7.5, 10]],
    [20, [0, 5, 10, 15, 20]],
    [4, [0, 1, 2, 3, 4]],
    [4.01, [0, 2, 4, 6, 8]],
    [1000, [0, 250, 500, 750, 1000]],
  ])('axisTicks(%s)', (max, ticks) => {
    expect(axisTicks(max)).toEqual(ticks)
  })

  it('always reaches the maximum with the last tick', () => {
    for (const max of [0.013, 0.7, 3, 17, 99, 123.4, 5_000, 87_654]) {
      const ticks = axisTicks(max)
      expect(ticks).toHaveLength(5)
      expect(ticks[4]).toBeGreaterThanOrEqual(max)
    }
  })
})

describe('chartBars', () => {
  it('stacks segments bottom to top in source order and skips zero amounts', () => {
    const bars = chartBars([row(5, { liquidity: '200000000', pillar: '100000000' })], 'znn', 4)

    expect(bars[0].epoch).toBe(5)
    expect(bars[0].total).toBe(300000000n)
    expect(bars[0].segments.map((s) => s.type)).toEqual(['pillar', 'liquidity'])
    expect(bars[0].segments[0].heightPct).toBeCloseTo(25)
    expect(bars[0].segments[1].heightPct).toBeCloseTo(50)
  })

  it('reads the chosen token only', () => {
    const bars = chartBars([row(1, { pillar: '100000000' }, { stake: '400000000' })], 'qsr', 4)

    expect(bars[0].segments.map((s) => s.type)).toEqual(['stake'])
    expect(bars[0].total).toBe(400000000n)
  })

  it('keeps history order and gives an empty epoch no segments', () => {
    const bars = chartBars([row(7), row(8, { stake: '100000000' })], 'znn', 1)

    expect(bars.map((b) => b.epoch)).toEqual([7, 8])
    expect(bars[0].segments).toEqual([])
    expect(bars[0].total).toBe(0n)
  })

  it('gives a zero height when the axis maximum is not positive', () => {
    const bars = chartBars([row(1, { pillar: '100000000' })], 'znn', 0)

    expect(bars[0].segments[0].heightPct).toBe(0)
  })
})

describe('chartSources', () => {
  it('lists sources with an amount anywhere in the history, in source order', () => {
    const history = [row(1, { liquidity: '1' }), row(2, { stake: '5' })]

    expect(chartSources(history, 'znn')).toEqual(['stake', 'liquidity'])
    expect(chartSources(history, 'qsr')).toEqual([])
  })
})

describe('epochLabel', () => {
  it('gives the epoch alone without a genesis time', () => {
    expect(epochLabel(1801, null)).toBe('Epoch 1,801')
  })

  it('adds the UTC day and month of the epoch start', () => {
    // 2021-11-24 12:00 UTC genesis, epoch 2 starts 2021-11-26 12:00 UTC
    const genesis = Date.UTC(2021, 10, 24, 12) / 1000
    expect(epochLabel(2, genesis)).toBe('Epoch 2 · 26 Nov')
  })

  it('uses UTC, not the local time zone, at a day boundary', () => {
    const genesis = Date.UTC(2021, 0, 31, 23, 30) / 1000
    expect(epochLabel(0, genesis)).toBe('Epoch 0 · 31 Jan')
    expect(epochLabel(1, genesis)).toBe('Epoch 1 · 1 Feb')
  })
})

describe('nextFocus', () => {
  it('moves one bar and clamps at the ends', () => {
    expect(nextFocus(3, 'ArrowRight', 10)).toBe(4)
    expect(nextFocus(3, 'ArrowLeft', 10)).toBe(2)
    expect(nextFocus(0, 'ArrowLeft', 10)).toBe(0)
    expect(nextFocus(9, 'ArrowRight', 10)).toBe(9)
  })

  it('jumps to the ends with Home and End', () => {
    expect(nextFocus(4, 'Home', 10)).toBe(0)
    expect(nextFocus(4, 'End', 10)).toBe(9)
    expect(nextFocus(0, 'End', 0)).toBe(0)
  })

  it('keeps the index for other keys', () => {
    expect(nextFocus(4, 'a', 10)).toBe(4)
  })
})

describe('epochMax', () => {
  it('is 0 for an empty history', () => {
    expect(epochMax([], 'znn')).toBe(0)
  })

  it('picks the largest per-epoch total of the chosen token in whole units', () => {
    const history = [
      row(1, { pillar: '100000000', stake: '50000000' }, { pillar: '900000000' }),
      row(2, { stake: '400000000' }),
      row(3, { liquidity: '10000000' }),
    ]

    expect(epochMax(history, 'znn')).toBe(4)
    expect(epochMax(history, 'qsr')).toBe(9)
  })
})

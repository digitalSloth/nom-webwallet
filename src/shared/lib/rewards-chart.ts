import { REWARD_TYPES, epochStart } from '@/core/rewards-service'
import type { RewardEpoch, RewardType } from '@/core/rewards-service'

export type ChartToken = 'znn' | 'qsr'
export interface ChartSegment {
  type: RewardType
  raw: bigint
  heightPct: number
}
/** `segments` run bottom to top. */
export interface ChartBar {
  epoch: number
  total: bigint
  segments: ChartSegment[]
}

/** Fill colour of each reward source in both Rewards charts. */
export const SOURCE_COLORS: Record<RewardType, string> = {
  pillar: 'var(--chart-1)',
  stake: 'var(--chart-3)',
  sentinel: 'var(--chart-4)',
  liquidity: 'var(--chart-2)',
}

const toUnits = (raw: bigint): number => Number(raw) / 1e8

/**
 * Five ticks from 0 with a step of 1, 2, 2.5 or 5 × 10^k, the smallest whose
 * 4 × step is at least maxValue. maxValue ≤ 0 gives step 1.
 */
export function axisTicks(maxValue: number): number[] {
  let step = 1
  if (maxValue > 0) {
    const exponent = Math.floor(Math.log10(maxValue / 4))
    const candidates = [-1, 0, 1].flatMap((shift) =>
      [1, 2, 2.5, 5].map((m) => m * 10 ** (exponent + shift))
    )
    candidates.sort((a, b) => a - b)
    step = candidates.find((s) => 4 * s >= maxValue) ?? maxValue / 4
  }
  return [0, 1, 2, 3, 4].map((i) => Number((i * step).toPrecision(12)))
}

export function chartBars(
  history: readonly RewardEpoch[],
  token: ChartToken,
  axisMax: number
): ChartBar[] {
  return history.map((row) => {
    const segments: ChartSegment[] = []
    let total = 0n
    for (const type of REWARD_TYPES) {
      const raw = BigInt(row[token][type])
      if (raw === 0n) continue
      total += raw
      segments.push({ type, raw, heightPct: axisMax > 0 ? (toUnits(raw) / axisMax) * 100 : 0 })
    }
    return { epoch: row.epoch, total, segments }
  })
}

/** Sources with a non-zero amount for `token` anywhere in `history`, in REWARD_TYPES order. */
export function chartSources(history: readonly RewardEpoch[], token: ChartToken): RewardType[] {
  return REWARD_TYPES.filter((type) => history.some((row) => BigInt(row[token][type]) > 0n))
}

/** "Epoch 1,801 · 14 Oct", or "Epoch 1,801" when genesisSeconds is null. */
export function epochLabel(epoch: number, genesisSeconds: number | null): string {
  const base = `Epoch ${epoch.toLocaleString('en-US')}`
  if (genesisSeconds === null) return base
  const date = new Date(epochStart(epoch, genesisSeconds) * 1000).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  return `${base} · ${date}`
}

/** ArrowLeft/ArrowRight move one bar, Home/End jump to the ends, clamped; other keys keep `index`. */
export function nextFocus(index: number, key: string, count: number): number {
  const last = count - 1
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1)
    case 'ArrowRight':
      return Math.min(last, index + 1)
    case 'Home':
      return 0
    case 'End':
      return Math.max(0, last)
    default:
      return index
  }
}

/** The largest per-epoch total of `token` in `history`, in whole units; 0 for an empty history. */
export function epochMax(history: readonly RewardEpoch[], token: ChartToken): number {
  const totals = history.map((row) =>
    REWARD_TYPES.reduce((sum, type) => sum + BigInt(row[token][type]), 0n)
  )
  return Math.max(0, ...totals.map((t) => Number(t) / 1e8))
}

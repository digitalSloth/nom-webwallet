import { describe, expect, it } from 'vitest'
import { PlasmaBotError } from '@/core/plasma-bot-service'
import type { PlasmaBotStats, PlasmaBotTierKey } from '@/core/plasma-bot-service'
import {
  canCancelFusion,
  fusedAtHeight,
  lowestAvailableTier,
  parseFuseAmount,
  plasmaBotErrorText,
  plasmaPercent,
} from './plasma'

const GENERIC = 'Failed to get plasma from plazma.bot. Please try again.'

function stats(availableTiers: PlasmaBotTierKey[]): PlasmaBotStats {
  return { qsrAvailable: 1000, availableTiers, activeFusionCount: 0 }
}

describe('plasmaPercent', () => {
  it.each([
    [5, 0, 0],
    [5, -10, 0],
    [50, 100, 50],
    [1, 3, 33],
    [150, 100, 100],
    [0, 100, 0],
    [-5, 100, 0],
  ])('current %d of max %d is %d%%', (current, max, expected) => {
    expect(plasmaPercent(current, max)).toBe(expected)
  })
})

describe('lowestAvailableTier', () => {
  it('picks the cheapest available tier', () => {
    expect(lowestAvailableTier(stats(['medium', 'high']), 'online')).toBe('medium')
  })

  it('follows tier order, not list order', () => {
    expect(lowestAvailableTier(stats(['high', 'low']), 'online')).toBe('low')
  })

  it('returns null when the bot has no tier available', () => {
    expect(lowestAvailableTier(stats([]), 'online')).toBeNull()
  })

  it('returns null when online without stats', () => {
    expect(lowestAvailableTier(null, 'online')).toBeNull()
  })

  it.each(['unreachable', 'checking', 'idle'] as const)(
    'falls back to the lowest tier when status is %s',
    (status) => {
      expect(lowestAvailableTier(null, status)).toBe('low')
    }
  )
})

describe('canCancelFusion', () => {
  it('is false while the frontier is unknown', () => {
    expect(canCancelFusion({ expirationHeight: 0 }, 0)).toBe(false)
  })

  it('is false before the expiration height', () => {
    expect(canCancelFusion({ expirationHeight: 100 }, 99)).toBe(false)
  })

  it('is true at the expiration height', () => {
    expect(canCancelFusion({ expirationHeight: 100 }, 100)).toBe(true)
  })

  it('is true after the expiration height', () => {
    expect(canCancelFusion({ expirationHeight: 100 }, 101)).toBe(true)
  })
})

describe('parseFuseAmount', () => {
  const available = 931_007_000_000n

  it.each(['', '  '])('treats %j as empty without an error', (input) => {
    expect(parseFuseAmount(input, available)).toEqual({ raw: null, error: null })
  })

  it('converts whole QSR to raw units', () => {
    expect(parseFuseAmount('50', available)).toEqual({ raw: 5_000_000_000n, error: null })
  })

  it('accepts the minimum', () => {
    expect(parseFuseAmount('10', available)).toEqual({ raw: 1_000_000_000n, error: null })
  })

  it('trims surrounding spaces', () => {
    expect(parseFuseAmount(' 20 ', available)).toEqual({ raw: 2_000_000_000n, error: null })
  })

  it('accepts the full available balance', () => {
    expect(parseFuseAmount('9310', available).raw).toBe(931_000_000_000n)
  })

  it('accepts an amount equal to the available balance', () => {
    expect(parseFuseAmount('10', 1_000_000_000n)).toEqual({ raw: 1_000_000_000n, error: null })
  })

  it('rejects an amount below the minimum', () => {
    expect(parseFuseAmount('9', available)).toEqual({ raw: null, error: 'Minimum is 10 QSR' })
  })

  it.each(['10.5', '1e3', 'abc', '-20'])('rejects %j as not a whole number', (input) => {
    expect(parseFuseAmount(input, available)).toEqual({
      raw: null,
      error: 'Enter a whole number of QSR',
    })
  })

  it('rejects an amount above the available balance', () => {
    expect(parseFuseAmount('10000', available)).toEqual({
      raw: null,
      error: 'Insufficient QSR balance',
    })
  })

  it('rejects any valid amount with a zero balance', () => {
    expect(parseFuseAmount('10', 0n)).toEqual({ raw: null, error: 'Insufficient QSR balance' })
  })
})

describe('plasmaBotErrorText', () => {
  it.each([
    ['ADDRESS_UNAVAILABLE', 'You already have an active plazma.bot fusion for this account.'],
    ['RATE_LIMITED', 'plazma.bot rate limit reached. Please try again later.'],
    ['INSUFFICIENT_BALANCE', 'plazma.bot is low on QSR right now. Try again later.'],
    ['VALIDATION_FAILED', 'Could not request plasma: invalid request.'],
  ] as const)('maps %s', (code, text) => {
    expect(plasmaBotErrorText(new PlasmaBotError(code, 'x'))).toBe(text)
  })

  it('uses the generic text for FUSE_FAILED', () => {
    expect(plasmaBotErrorText(new PlasmaBotError('FUSE_FAILED', 'x'))).toBe(GENERIC)
  })

  it('uses the generic text for a plain Error', () => {
    expect(plasmaBotErrorText(new Error('boom'))).toBe(GENERIC)
  })
})

describe('fusedAtHeight', () => {
  it('is the expiration height minus the revoke window', () => {
    expect(fusedAtHeight({ expirationHeight: 13_404_820 })).toBe(13_401_220)
  })
})

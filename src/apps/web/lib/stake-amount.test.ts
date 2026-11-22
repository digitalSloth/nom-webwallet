import { describe, expect, it } from 'vitest'
import { STAKE_DURATION_OPTIONS, STAKE_MONTH_SECONDS } from '@/config'
import { parseStakeAmount } from './stake-amount'

const AVAILABLE = 500_000_000n

describe('parseStakeAmount', () => {
  it('gives no result and no error for empty text', () => {
    expect(parseStakeAmount('', AVAILABLE)).toEqual({ raw: null, error: null })
    expect(parseStakeAmount('  ', AVAILABLE)).toEqual({ raw: null, error: null })
  })

  it.each(['abc', '-1', '1.123456789'])('rejects %j as invalid', (text) => {
    expect(parseStakeAmount(text, AVAILABLE).error).toBe('Enter a valid amount (up to 8 decimals)')
  })

  it('rejects an amount below 1 ZNN', () => {
    expect(parseStakeAmount('0.99999999', AVAILABLE)).toEqual({
      raw: null,
      error: 'Minimum is 1 ZNN',
    })
  })

  it('accepts exactly 1 ZNN and exactly the available balance', () => {
    expect(parseStakeAmount('1', AVAILABLE).raw).toBe(100_000_000n)
    expect(parseStakeAmount('5', AVAILABLE)).toEqual({ raw: 500_000_000n, error: null })
  })

  it('rejects one base unit above the balance', () => {
    expect(parseStakeAmount('5.00000001', AVAILABLE)).toEqual({
      raw: null,
      error: 'Insufficient ZNN balance',
    })
  })

  it('keeps all eight decimals', () => {
    expect(parseStakeAmount('1.12345678', AVAILABLE).raw).toBe(112345678n)
  })
})

describe('stake durations', () => {
  it('offers whole months from 1 to 12 in ascending order', () => {
    const months = STAKE_DURATION_OPTIONS.map((o) => o.value / STAKE_MONTH_SECONDS)

    expect(months).toEqual([1, 3, 6, 9, 12])
    expect(months.every((m) => Number.isInteger(m) && m >= 1 && m <= 12)).toBe(true)
  })

  it('has a month of 30 days', () => {
    expect(STAKE_MONTH_SECONDS).toBe(30 * 86_400)
  })
})

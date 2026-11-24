import { describe, expect, it } from 'vitest'

import { amountShare, formatAmount, isValidAddress, parseAmount } from './amount'

const ADDRESS = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

describe('parseAmount', () => {
  it('parses a full-precision decimal to exact base units', () => {
    expect(parseAmount('0.12345678', 8)).toBe(12345678n)
  })

  it('parses whole numbers, fractions and padded fractions', () => {
    expect(parseAmount('1', 8)).toBe(100000000n)
    expect(parseAmount('1.5', 8)).toBe(150000000n)
    expect(parseAmount('0.00000001', 8)).toBe(1n)
    expect(parseAmount('0', 8)).toBe(0n)
    expect(parseAmount('7', 0)).toBe(7n)
  })

  it('trims surrounding whitespace', () => {
    expect(parseAmount(' 2 ', 8)).toBe(200000000n)
  })

  it('stays exact beyond Number precision', () => {
    expect(parseAmount('12345678901.23456789', 8)).toBe(1234567890123456789n)
  })

  it.each(['0.123456789', '1e5', '', '.5', '1.', '1,5', '-1', '+1', '1.5.2', 'abc', '1 2'])(
    'rejects %j',
    (input) => {
      expect(parseAmount(input, 8)).toBeNull()
    }
  )

  it('rejects any fraction at 0 decimals', () => {
    expect(parseAmount('1.0', 0)).toBeNull()
  })
})

describe('formatAmount', () => {
  it('formats without trailing zeros', () => {
    expect(formatAmount(150000000n, 8)).toBe('1.5')
    expect(formatAmount(100000000n, 8)).toBe('1')
    expect(formatAmount(1n, 8)).toBe('0.00000001')
    expect(formatAmount(0n, 8)).toBe('0')
    expect(formatAmount(42n, 0)).toBe('42')
  })

  it.each([
    [0n, 8],
    [1n, 8],
    [12345678n, 8],
    [12345678901234567890n, 8],
    [0n, 0],
    [987n, 0],
    [12345678901234567890n, 0],
  ])('round-trips %s at %i decimals', (raw, decimals) => {
    expect(parseAmount(formatAmount(raw, decimals), decimals)).toBe(raw)
  })
})

describe('isValidAddress', () => {
  it('accepts a real address', () => {
    expect(isValidAddress(ADDRESS)).toBe(true)
  })

  it('rejects a bad checksum', () => {
    expect(isValidAddress(ADDRESS.slice(0, -1) + (ADDRESS.endsWith('z') ? 'q' : 'z'))).toBe(false)
  })

  it('rejects a wrong prefix', () => {
    expect(isValidAddress('a' + ADDRESS.slice(1))).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isValidAddress('')).toBe(false)
  })
})

describe('amountShare', () => {
  it('formats a percentage of the balance', () => {
    expect(amountShare(1001n, 25n, 2)).toBe('2.5')
  })

  it('returns the whole balance at 100 percent', () => {
    expect(amountShare(123456789n, 100n, 8)).toBe(formatAmount(123456789n, 8))
  })

  it.each([25n, 50n, 75n])('parses back to exactly balance * %s / 100 at 8 decimals', (p) => {
    const balance = 1234567891n
    expect(parseAmount(amountShare(balance, p, 8), 8)).toBe((balance * p) / 100n)
  })
})

import { describe, expect, it } from 'vitest'
import type { Token } from 'znn-typescript-sdk'
import { ownedRow } from './owned-tokens'

function token(over: Partial<Record<string, unknown>> = {}): Token {
  return {
    symbol: 'TST',
    name: 'Test token',
    tokenStandard: { toString: () => 'zts1test' },
    decimals: 0,
    totalSupply: 0n,
    maxSupply: 0n,
    isMintable: false,
    isBurnable: false,
    isUtility: false,
    ...over,
  } as unknown as Token
}

describe('ownedRow amounts', () => {
  const cases: [string, bigint, number, string][] = [
    ['0 decimals grouped', 1234567n, 0, '1,234,567'],
    ['8 decimals whole', 100000000000000n, 8, '1,000,000'],
    ['8 decimals fraction only', 123456789n, 8, '1.23456789'],
    ['18 decimals trimmed', 1234500000000000000000n, 18, '1,234.5'],
    ['zero at 0 decimals', 0n, 0, '0'],
    ['zero at 8 decimals', 0n, 8, '0'],
    ['below one', 1n, 8, '0.00000001'],
  ]

  it.each(cases)('formats %s', (_name, raw, decimals, expected) => {
    const row = ownedRow(token({ totalSupply: raw, maxSupply: raw, decimals }))

    expect(row.supply).toBe(expected)
    expect(row.max).toBe(expected)
  })

  it('formats supply and max independently', () => {
    const row = ownedRow(token({ totalSupply: 1000n, maxSupply: 2000000n }))

    expect(row.supply).toBe('1,000')
    expect(row.max).toBe('2,000,000')
  })

  it('keeps every digit of 2^255 - 1 with no float conversion', () => {
    const big = 2n ** 255n - 1n
    const expected = big.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const row = ownedRow(token({ totalSupply: big, maxSupply: big }))

    expect(row.supply).toBe(expected)
    expect(row.max).toBe(expected)
    expect(row.supply.replace(/,/g, '')).toBe(big.toString())
  })

  it('keeps the whole digits of a very large 18-decimal supply', () => {
    const raw = 123456789012345678901234567890123456789n
    const row = ownedRow(token({ totalSupply: raw, decimals: 18 }))

    expect(row.supply).toBe('123,456,789,012,345,678,901.234567890123456789')
  })
})

describe('ownedRow flags', () => {
  it.each([true, false])('labels mintable=%s', (on) => {
    expect(ownedRow(token({ isMintable: on })).flags[0]).toEqual({
      label: on ? 'Mintable' : 'Fixed supply',
      on,
    })
  })

  it.each([true, false])('labels burnable=%s', (on) => {
    expect(ownedRow(token({ isBurnable: on })).flags[1]).toEqual({
      label: on ? 'Burnable' : 'Owner burns only',
      on,
    })
  })

  it.each([true, false])('labels utility=%s', (on) => {
    expect(ownedRow(token({ isUtility: on })).flags[2]).toEqual({
      label: on ? 'Utility' : 'Not utility',
      on,
    })
  })

  it('has exactly three flags', () => {
    expect(ownedRow(token()).flags).toHaveLength(3)
  })
})

describe('ownedRow identity', () => {
  it('copies symbol and name and stringifies the token standard', () => {
    const row = ownedRow(token({ symbol: 'ABC', name: 'Alpha' }))

    expect(row).toMatchObject({ symbol: 'ABC', name: 'Alpha', zts: 'zts1test' })
  })
})

describe('ownedRow canMint', () => {
  it('is true for a mintable token below its max supply', () => {
    expect(ownedRow(token({ isMintable: true, totalSupply: 5n, maxSupply: 6n })).canMint).toBe(true)
  })

  it('is false for a fixed supply, even below the max', () => {
    expect(ownedRow(token({ isMintable: false, totalSupply: 5n, maxSupply: 6n })).canMint).toBe(
      false
    )
  })

  it('is false for a mintable token at its max supply', () => {
    expect(ownedRow(token({ isMintable: true, totalSupply: 6n, maxSupply: 6n })).canMint).toBe(
      false
    )
  })

  it('compares as bigint one raw unit below 2^255 - 1', () => {
    const max = 2n ** 255n - 1n
    expect(
      ownedRow(token({ isMintable: true, totalSupply: max - 1n, maxSupply: max })).canMint
    ).toBe(true)
    expect(ownedRow(token({ isMintable: true, totalSupply: max, maxSupply: max })).canMint).toBe(
      false
    )
  })
})

import { describe, expect, it } from 'vitest'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { BalanceInfo } from '@/types'
import { tokenRows } from './token-rows'

const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()

const token = (symbol: string, balance: string, over: Partial<BalanceInfo> = {}): BalanceInfo => ({
  tokenStandard: `zts1${symbol.toLowerCase()}xx`,
  balance,
  decimals: 8,
  symbol,
  name: `${symbol} Token`,
  ...over,
})

const znn = token('ZNN', '100', { tokenStandard: ZNN, name: 'Zenon' })
const qsr = token('QSR', '100', { tokenStandard: QSR, name: 'Quasar' })

const symbols = (rows: BalanceInfo[]) => rows.map((r) => r.symbol)

describe('tokenRows', () => {
  it('drops zero balances', () => {
    expect(symbols(tokenRows([znn, token('AAA', '0'), token('BBB', '5')], ''))).toEqual([
      'ZNN',
      'BBB',
    ])
  })

  it('orders ZNN, then QSR, then by symbol whatever the input order', () => {
    const rows = tokenRows([token('ZZZ', '1'), token('AAA', '1'), qsr, token('MMM', '1'), znn], '')

    expect(symbols(rows)).toEqual(['ZNN', 'QSR', 'AAA', 'MMM', 'ZZZ'])
  })

  it('returns everything above zero for an empty or blank query', () => {
    expect(tokenRows([znn, qsr], '')).toHaveLength(2)
    expect(tokenRows([znn, qsr], '   ')).toHaveLength(2)
  })

  it('matches the symbol case-insensitively', () => {
    expect(symbols(tokenRows([znn, qsr], 'qs'))).toEqual(['QSR'])
  })

  it('matches the name', () => {
    expect(symbols(tokenRows([znn, qsr], 'ZENO'))).toEqual(['ZNN'])
  })

  it('matches the token standard', () => {
    const other = token('AAA', '1', { tokenStandard: 'zts1uniquestandard' })

    expect(symbols(tokenRows([znn, other], 'UNIQUESTAND'))).toEqual(['AAA'])
  })

  it('trims the query', () => {
    expect(symbols(tokenRows([znn, qsr], '  quasar  '))).toEqual(['QSR'])
  })

  it('returns nothing when no token matches', () => {
    expect(tokenRows([znn, qsr], 'nope')).toEqual([])
  })

  it('handles a token without symbol or name', () => {
    const bare = token('X', '1', { symbol: undefined, name: undefined, tokenStandard: 'zts1bare' })

    expect(tokenRows([bare], 'bare')).toEqual([bare])
    expect(tokenRows([bare], 'zzz')).toEqual([])
  })

  it('does not mutate the input array', () => {
    const input = [qsr, znn]

    tokenRows(input, '')

    expect(input).toEqual([qsr, znn])
  })

  it('keeps a balance above the safe integer range', () => {
    expect(tokenRows([token('BIG', '90071992547409930000')], '')).toHaveLength(1)
  })
})

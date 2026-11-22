import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { BalanceInfo } from '@/types'

function rank(balance: BalanceInfo): number {
  if (balance.tokenStandard === ZNN_ZTS.toString()) return 0
  if (balance.tokenStandard === QSR_ZTS.toString()) return 1
  return 2
}

/**
 * Balances above zero, ZNN then QSR then by symbol, filtered by a case-insensitive
 * match of the trimmed query in symbol, name or token standard.
 */
export function tokenRows(balances: BalanceInfo[], query: string): BalanceInfo[] {
  const needle = query.trim().toLowerCase()
  return balances
    .filter((b) => BigInt(b.balance) > 0n)
    .filter(
      (b) =>
        needle === '' ||
        [b.symbol, b.name, b.tokenStandard].some((text) =>
          (text ?? '').toLowerCase().includes(needle)
        )
    )
    .sort((a, b) => rank(a) - rank(b) || (a.symbol ?? '').localeCompare(b.symbol ?? ''))
}

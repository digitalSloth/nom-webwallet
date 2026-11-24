import { ref, type Ref } from 'vue'
import { addNumberDecimals, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import { AccountService } from '../account-service'

export interface AccountBalance {
  // Decimal strings, e.g. '1284.52'
  znn: string
  qsr: string
}

/** ZNN and QSR balances for a list of addresses, read in parallel. */
export function useAccountBalances(addresses: () => string[]): {
  balances: Ref<Record<string, AccountBalance>>
  load(): Promise<void>
} {
  const accountService = AccountService.getInstance()
  const balances = ref<Record<string, AccountBalance>>({})
  let latestLoad = 0

  async function load(): Promise<void> {
    const load = ++latestLoad
    const list = addresses()
    const results = await Promise.allSettled(list.map((a) => accountService.getAccountInfo(a)))
    // A newer load owns the result; an older response must not overwrite it.
    if (load !== latestLoad) return

    const next: Record<string, AccountBalance> = {}
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        console.error('Failed to load account balance:', result.reason)
        return
      }
      const map = result.value?.balanceInfoMap ?? {}
      const read = (zts: string): string => {
        const info = map[zts]
        return info ? addNumberDecimals(info.balance.toString(), info.token.decimals) : '0'
      }
      next[list[i]] = { znn: read(ZNN_ZTS.toString()), qsr: read(QSR_ZTS.toString()) }
    })
    balances.value = next
  }

  return { balances, load }
}

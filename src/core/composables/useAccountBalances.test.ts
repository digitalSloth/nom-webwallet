import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'

const accountService = { getAccountInfo: vi.fn() }

vi.mock('@/core/account-service', () => ({
  AccountService: { getInstance: () => accountService },
}))

import { useAccountBalances } from './useAccountBalances'

function info(znn?: string, qsr?: string) {
  const balanceInfoMap: Record<string, unknown> = {}
  if (znn !== undefined) {
    balanceInfoMap[ZNN_ZTS.toString()] = { balance: BigInt(znn), token: { decimals: 8 } }
  }
  if (qsr !== undefined) {
    balanceInfoMap[QSR_ZTS.toString()] = { balance: BigInt(qsr), token: { decimals: 8 } }
  }
  return { balanceInfoMap }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('useAccountBalances', () => {
  it('maps ZNN and QSR to decimal strings per address', async () => {
    accountService.getAccountInfo.mockImplementation(async (a: string) =>
      a === 'z1a' ? info('128452000000', '50000000') : info('100000000', '250000000')
    )
    const { balances, load } = useAccountBalances(() => ['z1a', 'z1b'])

    await load()

    expect(balances.value).toEqual({
      z1a: { znn: '1284.52', qsr: '0.5' },
      z1b: { znn: '1', qsr: '2.5' },
    })
  })

  it('reports a missing token as 0', async () => {
    accountService.getAccountInfo.mockResolvedValue(info('100000000'))
    const { balances, load } = useAccountBalances(() => ['z1a'])

    await load()

    expect(balances.value.z1a).toEqual({ znn: '1', qsr: '0' })
  })

  it('omits a rejected address and keeps the others', async () => {
    accountService.getAccountInfo.mockImplementation(async (a: string) => {
      if (a === 'z1bad') throw new Error('rpc')
      return info('100000000', '0')
    })
    const { balances, load } = useAccountBalances(() => ['z1a', 'z1bad'])

    await expect(load()).resolves.toBeUndefined()

    expect(Object.keys(balances.value)).toEqual(['z1a'])
  })

  it('ignores an older load that resolves after a newer one', async () => {
    let releaseOld!: () => void
    accountService.getAccountInfo.mockImplementationOnce(
      () => new Promise((resolve) => (releaseOld = () => resolve(info('100000000', '0'))))
    )
    accountService.getAccountInfo.mockResolvedValueOnce(info('900000000', '0'))
    const { balances, load } = useAccountBalances(() => ['z1a'])

    const older = load()
    await load()
    releaseOld()
    await older

    expect(balances.value.z1a.znn).toBe('9')
  })
})

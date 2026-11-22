import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const accountService = {
  getAccountInfo: vi.fn(),
  getPlasmaInfo: vi.fn(),
  getBasicSendQuote: vi.fn(),
  getPlasmaLevel: vi.fn(() => 'low'),
  getUnreceivedBlocks: vi.fn(),
  getDelegatedPillar: vi.fn(),
}
const rewardsService = { getAllUncollectedRewards: vi.fn() }

vi.mock('@/core/account-service', () => ({
  AccountService: { getInstance: () => accountService },
}))
const reportNodeFailure = vi.fn()
vi.mock('@/core/node-health', () => ({ reportNodeFailure: () => reportNodeFailure() }))
vi.mock('@/core/rewards-service', () => ({
  RewardsService: { getInstance: () => rewardsService },
}))

import { configureAccountData, useAccount } from './useAccount'

const ADDRESS = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

beforeEach(() => {
  configureAccountData({ staking: true })
  vi.clearAllMocks()
  accountService.getAccountInfo.mockResolvedValue({ balanceInfoMap: {}, blockCount: 0 })
  accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 0 })
  accountService.getBasicSendQuote.mockResolvedValue({ available: 0, perSend: 21_000 })
  accountService.getPlasmaLevel.mockReturnValue('low')
  accountService.getUnreceivedBlocks.mockResolvedValue({ list: [], count: 0, more: false })
  accountService.getDelegatedPillar.mockResolvedValue(null)
  rewardsService.getAllUncollectedRewards.mockResolvedValue([])
})

describe('loadAccountData', () => {
  it('reads delegation and rewards by default', async () => {
    await useAccount(ADDRESS).loadAccountData()

    expect(accountService.getDelegatedPillar).toHaveBeenCalledWith(ADDRESS)
    expect(rewardsService.getAllUncollectedRewards).toHaveBeenCalledWith(ADDRESS)
  })

  it('skips delegation and rewards when staking is disabled', async () => {
    configureAccountData({ staking: false })

    await useAccount(ADDRESS).loadAccountData()

    expect(accountService.getDelegatedPillar).not.toHaveBeenCalled()
    expect(rewardsService.getAllUncollectedRewards).not.toHaveBeenCalled()
    expect(accountService.getAccountInfo).toHaveBeenCalledWith(ADDRESS)
    expect(accountService.getPlasmaInfo).toHaveBeenCalledWith(ADDRESS)
    expect(accountService.getUnreceivedBlocks).toHaveBeenCalled()
  })

  it('reads nothing without an address', async () => {
    await useAccount(null).loadAccountData()

    expect(accountService.getAccountInfo).not.toHaveBeenCalled()
  })
})

describe('loadPlasmaInfo', () => {
  it('sets current and max plasma from the account service', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({
      currentPlasma: 5,
      maxPlasma: 10,
      qsrAmount: 0n,
    })
    const account = useAccount(ADDRESS)

    await account.loadPlasmaInfo()

    expect(account.currentPlasma.value).toBe(5)
    expect(account.maxPlasma.value).toBe(10)
  })

  it('sets the level from the basic-send quote', async () => {
    accountService.getBasicSendQuote.mockResolvedValue({ available: 231_000, perSend: 23_100 })
    accountService.getPlasmaLevel.mockReturnValue('high')
    accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 5, maxPlasma: 10, qsrAmount: 0n })
    const account = useAccount(ADDRESS)

    await account.loadPlasmaInfo()

    expect(accountService.getBasicSendQuote).toHaveBeenCalledWith(ADDRESS)
    expect(accountService.getPlasmaLevel).toHaveBeenCalledWith(231_000, 23_100)
    expect(account.plasmaLevel.value).toBe('high')
  })

  it('falls back to low with empty plasma when the quote fails', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 5, maxPlasma: 10, qsrAmount: 7n })
    accountService.getBasicSendQuote.mockRejectedValue(new Error('offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const account = useAccount(ADDRESS)

    await account.loadPlasmaInfo()

    expect(account.plasmaLevel.value).toBe('low')
    expect(account.currentPlasma.value).toBe(0)
    expect(account.maxPlasma.value).toBe(0)
    expect(account.fusedQsr.value).toBe('0')
    log.mockRestore()
  })

  it('sets fusedQsr from the plasma info as a string', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({
      currentPlasma: 5,
      maxPlasma: 10,
      qsrAmount: 1234500000000n,
    })
    const account = useAccount(ADDRESS)

    await account.loadPlasmaInfo()

    expect(account.fusedQsr.value).toBe('1234500000000')
  })

  it('resets fusedQsr to 0 when a later load fails', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 5, maxPlasma: 10, qsrAmount: 7n })
    const account = useAccount(ADDRESS)
    await account.loadPlasmaInfo()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    accountService.getPlasmaInfo.mockRejectedValue(new Error('offline'))

    await account.loadPlasmaInfo()

    expect(account.fusedQsr.value).toBe('0')
    log.mockRestore()
  })

  it('resets max plasma when a later load fails', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 5, maxPlasma: 10 })
    const account = useAccount(ADDRESS)
    await account.loadPlasmaInfo()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    accountService.getPlasmaInfo.mockRejectedValue(new Error('offline'))

    await account.loadPlasmaInfo()

    expect(account.maxPlasma.value).toBe(0)
    expect(account.currentPlasma.value).toBe(0)
    log.mockRestore()
  })

  it('sets max plasma to 0 without an address', async () => {
    accountService.getPlasmaInfo.mockResolvedValue({ currentPlasma: 5, maxPlasma: 10 })
    await useAccount(ADDRESS).loadPlasmaInfo()
    const account = useAccount(null)

    await account.loadPlasmaInfo()

    expect(account.maxPlasma.value).toBe(0)
  })
})

describe('isNewAccount', () => {
  const OTHER = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'
  const info = (over: Record<string, unknown> = {}) => ({ balanceInfoMap: {}, blockCount: 0, ...over })
  const entry = (balance: bigint) => ({
    ZNN: { balance, token: { symbol: 'ZNN', decimals: 8, tokenStandard: 'zts1znn' } },
  })
  let fresh: typeof import('./useAccount').useAccount

  beforeEach(async () => {
    vi.resetModules()
    fresh = (await import('./useAccount')).useAccount
  })

  it('is false before the first load', () => {
    expect(fresh(ADDRESS).isNewAccount.value).toBe(false)
  })

  it('is true after a load with no blocks and no balances', async () => {
    const account = fresh(ADDRESS)

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(true)
  })

  it('is true with a zero balance entry', async () => {
    accountService.getAccountInfo.mockResolvedValue(info({ balanceInfoMap: entry(0n) }))
    const account = fresh(ADDRESS)

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(true)
  })

  it('is false with a non-zero balance', async () => {
    accountService.getAccountInfo.mockResolvedValue(info({ balanceInfoMap: entry(1n) }))
    const account = fresh(ADDRESS)

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(false)
  })

  it('is false when the account has blocks', async () => {
    accountService.getAccountInfo.mockResolvedValue(info({ blockCount: 3 }))
    const account = fresh(ADDRESS)

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(false)
  })

  it('is false for a second address before its own load', async () => {
    const current = ref(ADDRESS)
    const account = fresh(() => current.value)
    await account.loadBalances()
    expect(account.isNewAccount.value).toBe(true)

    current.value = OTHER

    expect(account.isNewAccount.value).toBe(false)
  })

  it('is false after a failed load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    accountService.getAccountInfo.mockRejectedValue(new Error('offline'))
    const account = fresh(ADDRESS)

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(false)
  })

  it('is false for a second address whose load fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const current = ref(ADDRESS)
    const account = fresh(() => current.value)
    await account.loadBalances()
    current.value = OTHER
    accountService.getAccountInfo.mockRejectedValue(new Error('offline'))

    await account.loadBalances()

    expect(account.isNewAccount.value).toBe(false)
  })
})

describe('loadBalances node health', () => {
  it('reports a node failure when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    accountService.getAccountInfo.mockRejectedValue(new Error('offline'))

    await useAccount(ADDRESS).loadBalances()

    expect(reportNodeFailure).toHaveBeenCalledOnce()
  })

  it('reports nothing when the read succeeds', async () => {
    await useAccount(ADDRESS).loadBalances()

    expect(reportNodeFailure).not.toHaveBeenCalled()
  })
})

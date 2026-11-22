import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Address, PLASMA_ADDRESS, Zenon, type AccountBlock } from 'znn-typescript-sdk'

const getAccountBlocks = vi.fn()
const getAccountInfo = vi.fn()
const getAccountBlocksByHeight = vi.fn()

vi.mock('@/core/account-service', () => ({
  AccountService: {
    getInstance: () => ({ getAccountBlocks, getAccountInfo, getAccountBlocksByHeight }),
  },
}))

import {
  ACTIVITY_PAGE_SIZE,
  activityLabel,
  useActivityPages,
  recentRecipients,
  toActivityRow,
  useAccountHistory,
} from './useAccountHistory'

const OWN = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'
const OTHER = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'
const USER_SEND = 2
const USER_RECEIVE = 3

const zts = { symbol: 'ZNN', decimals: 8 }

function block(overrides: Record<string, unknown> = {}): AccountBlock {
  return {
    blockType: USER_SEND,
    hash: { toString: () => 'hash-1' },
    height: 7,
    address: { toString: () => OWN },
    toAddress: { toString: () => OTHER, core: new Uint8Array([0]) },
    amount: 150n,
    token: zts,
    data: new Uint8Array(),
    confirmationDetail: { momentumTimestamp: 1_700_000_000 },
    ...overrides,
  } as unknown as AccountBlock
}

describe('toActivityRow', () => {
  it('maps a user send to an outgoing row with the recipient as counterparty', () => {
    const row = toActivityRow(block(), OWN)

    expect(row).toEqual({
      hash: 'hash-1',
      height: 7,
      status: 'notReceived',
      direction: 'out',
      amount: '150',
      decimals: 8,
      symbol: 'ZNN',
      counterparty: OTHER,
      label: null,
      timestamp: 1_700_000_000_000,
    })
  })

  it('takes amount, token and counterparty of a receive from the paired send', () => {
    const paired = block({
      address: { toString: () => OTHER },
      toAddress: { toString: () => OWN, core: new Uint8Array([0]) },
      amount: 999n,
      token: { symbol: 'QSR', decimals: 6 },
    })
    const row = toActivityRow(
      block({ blockType: USER_RECEIVE, amount: 0n, token: null, pairedAccountBlock: paired }),
      OWN
    )

    expect(row).toMatchObject({
      direction: 'in',
      amount: '999',
      decimals: 6,
      symbol: 'QSR',
      counterparty: OTHER,
    })
  })

  it('labels a send to an embedded contract', () => {
    const fuse = Zenon.getInstance().embedded.plasma.fuse(Address.parse(OWN), 10n ** 9n)
    const row = toActivityRow(
      block({ toAddress: PLASMA_ADDRESS, data: fuse.data, token: { symbol: 'QSR', decimals: 8 } }),
      OWN
    )

    expect(row.direction).toBe('contract')
    expect(row.label).toBe('Plasma · Fuse')
  })

  it('marks a confirmed send with a paired block as received', () => {
    const row = toActivityRow(
      block({ pairedAccountBlock: block({ blockType: USER_RECEIVE }) }),
      OWN
    )

    expect(row.status).toBe('received')
  })

  it('marks an unconfirmed block as unconfirmed', () => {
    expect(toActivityRow(block({ confirmationDetail: undefined }), OWN).status).toBe('unconfirmed')
  })

  it('carries the account height of the block', () => {
    expect(toActivityRow(block({ height: 31 }), OWN).height).toBe(31)
  })

  it('gives a null timestamp to an unconfirmed block', () => {
    expect(toActivityRow(block({ confirmationDetail: undefined }), OWN).timestamp).toBeNull()
  })

  it('uses empty token fields when the token is unknown', () => {
    const row = toActivityRow(block({ token: undefined }), OWN)

    expect(row.symbol).toBe('')
    expect(row.decimals).toBe(0)
  })
})

describe('useAccountHistory', () => {
  beforeEach(() => {
    getAccountBlocks.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  const page = (hash: string, more: boolean, count = 0) => ({
    list: [block({ hash: { toString: () => hash } })],
    more,
    count,
  })

  it('loads page 0 and replaces earlier rows on the next loadFirst', async () => {
    getAccountBlocks.mockResolvedValueOnce(page('a', true)).mockResolvedValueOnce(page('b', false))
    const history = useAccountHistory(() => OWN)

    await history.loadFirst()
    expect(getAccountBlocks).toHaveBeenLastCalledWith(OWN, 0, ACTIVITY_PAGE_SIZE)
    expect(history.rows.value.map((r) => r.hash)).toEqual(['a'])

    await history.loadFirst()
    expect(getAccountBlocks).toHaveBeenLastCalledWith(OWN, 0, ACTIVITY_PAGE_SIZE)
    expect(history.rows.value.map((r) => r.hash)).toEqual(['b'])
  })

  it('does nothing without an address', async () => {
    const history = useAccountHistory(() => null)

    await history.loadFirst()

    expect(getAccountBlocks).not.toHaveBeenCalled()
    expect(history.rows.value).toEqual([])
  })

  it('drops the result of a load superseded by a newer loadFirst', async () => {
    let resolveOld!: (value: unknown) => void
    getAccountBlocks
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce(page('new', false))
    const history = useAccountHistory(() => OWN)

    const older = history.loadFirst()
    await history.loadFirst()
    resolveOld(page('old', false))
    await older

    expect(history.rows.value.map((r) => r.hash)).toEqual(['new'])
  })
})

describe('toActivityRow status', () => {
  const CONTRACT_SEND = 4
  const CONTRACT_RECEIVE = 5
  const toContract = { core: new Uint8Array([1]) }

  it('is notReceived for a user send without a paired block', () => {
    expect(toActivityRow(block(), OWN).status).toBe('notReceived')
  })

  it('is confirmed for a confirmed receive block', () => {
    expect(toActivityRow(block({ blockType: USER_RECEIVE }), OWN).status).toBe('confirmed')
  })

  it('is confirmed for a contract send without a paired block', () => {
    const row = toActivityRow(block({ blockType: CONTRACT_SEND, toAddress: toContract }), OWN)

    expect(row.status).toBe('confirmed')
  })

  it('is executed for a contract send with a paired block that succeeded', () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]),
    })
    const row = toActivityRow(block({ toAddress: toContract, pairedAccountBlock: paired }), OWN)

    expect(row.status).toBe('executed')
  })

  it('is failed for a contract send whose paired block carries status 2', () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2]),
    })
    const row = toActivityRow(block({ toAddress: toContract, pairedAccountBlock: paired }), OWN)

    expect(row.status).toBe('failed')
  })

  it('reads the paired block only and never touches the node', () => {
    getAccountBlocks.mockClear()
    getAccountInfo.mockClear()

    toActivityRow(block({ pairedAccountBlock: block({ blockType: USER_RECEIVE }) }), OWN)

    expect(getAccountBlocks).not.toHaveBeenCalled()
    expect(getAccountInfo).not.toHaveBeenCalled()
  })
})

describe('activityLabel', () => {
  const row = (over: Record<string, unknown>) =>
    ({ ...toActivityRow(block(), OWN), ...over }) as ReturnType<typeof toActivityRow>

  it('says Received for an incoming row', () => {
    expect(activityLabel(row({ direction: 'in' }))).toBe('Received')
  })

  it('says Sent for an outgoing row', () => {
    expect(activityLabel(row({ direction: 'out' }))).toBe('Sent')
  })

  it('uses the decoded label of a contract row', () => {
    expect(activityLabel(row({ direction: 'contract', label: 'Plasma · Fuse' }))).toBe(
      'Plasma · Fuse'
    )
  })

  it('says Contract call for a contract row without a label', () => {
    expect(activityLabel(row({ direction: 'contract', label: null }))).toBe('Contract call')
  })
})

describe('useActivityPages', () => {
  beforeEach(() => {
    getAccountInfo.mockReset()
    getAccountBlocksByHeight.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  const at = (height: number) => block({ height, hash: { toString: () => `h${height}` } })
  const asc = (low: number, count: number) => ({
    list: Array.from({ length: count }, (_, i) => at(low + i)),
    count,
    more: false,
  })
  const heights = (pages: ReturnType<typeof useActivityPages>) =>
    pages.rows.value.map((r) => r.height)

  function serve(total: number) {
    getAccountInfo.mockResolvedValue({ blockCount: total })
    getAccountBlocksByHeight.mockImplementation(async (_a: string, low: number, count: number) =>
      asc(low, Math.min(count, total - low + 1))
    )
  }

  it('reads the newest ten heights on page 0 and lists them newest first', async () => {
    serve(1482)
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(getAccountBlocksByHeight).toHaveBeenCalledWith(OWN, 1473, 10)
    expect(pages.range.value).toEqual({ from: 1482, to: 1473 })
    expect(heights(pages)).toEqual([1482, 1481, 1480, 1479, 1478, 1477, 1476, 1475, 1474, 1473])
    expect(pages.total.value).toBe(1482)
    expect(pages.hasNewer.value).toBe(false)
    expect(pages.hasOlder.value).toBe(true)
  })

  it('reads heights 2 to 1 on the last page and disables Older', async () => {
    serve(1482)
    const pages = useActivityPages(() => OWN)
    await pages.load(0)

    await pages.load(148)

    expect(getAccountBlocksByHeight).toHaveBeenLastCalledWith(OWN, 1, 2)
    expect(pages.range.value).toEqual({ from: 2, to: 1 })
    expect(heights(pages)).toEqual([2, 1])
    expect(pages.hasOlder.value).toBe(false)
    expect(pages.hasNewer.value).toBe(true)
  })

  it('reads the exact window of a middle page', async () => {
    serve(1482)
    const pages = useActivityPages(() => OWN)
    await pages.load(0)

    await pages.load(1)

    expect(getAccountBlocksByHeight).toHaveBeenLastCalledWith(OWN, 1463, 10)
    expect(pages.range.value).toEqual({ from: 1472, to: 1463 })
    expect(pages.page.value).toBe(1)
  })

  it('shows an account of exactly ten blocks as one page', async () => {
    serve(10)
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(getAccountBlocksByHeight).toHaveBeenCalledWith(OWN, 1, 10)
    expect(pages.hasOlder.value).toBe(false)
    await pages.load(1)
    expect(pages.page.value).toBe(0)
  })

  it('has no rows, no range and no block read for an empty account', async () => {
    serve(0)
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(getAccountBlocksByHeight).not.toHaveBeenCalled()
    expect(pages.rows.value).toEqual([])
    expect(pages.range.value).toBeNull()
    expect(pages.hasOlder.value).toBe(false)
    expect(pages.hasNewer.value).toBe(false)
  })

  it('treats a missing account info as height 0', async () => {
    getAccountInfo.mockResolvedValue(null)
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(getAccountBlocksByHeight).not.toHaveBeenCalled()
    expect(pages.total.value).toBe(0)
  })

  it('sorts by height whatever order the node returns', async () => {
    getAccountInfo.mockResolvedValue({ blockCount: 30 })
    getAccountBlocksByHeight.mockResolvedValue({
      list: [at(23), at(30), at(25), at(21), at(28), at(22), at(29), at(24), at(27), at(26)],
      count: 10,
      more: false,
    })
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(heights(pages)).toEqual([30, 29, 28, 27, 26, 25, 24, 23, 22, 21])
  })

  it('drops blocks outside the requested window', async () => {
    getAccountInfo.mockResolvedValue({ blockCount: 30 })
    getAccountBlocksByHeight.mockResolvedValue({
      list: [at(20), at(21), at(30), at(31)],
      count: 4,
      more: false,
    })
    const pages = useActivityPages(() => OWN)

    await pages.load(0)

    expect(heights(pages)).toEqual([30, 21])
  })

  it('reads the account height again on load(0) but not on later pages', async () => {
    serve(100)
    const pages = useActivityPages(() => OWN)

    await pages.load(0)
    await pages.load(0)
    expect(getAccountInfo).toHaveBeenCalledTimes(2)

    await pages.load(1)
    expect(getAccountInfo).toHaveBeenCalledTimes(2)
  })

  it('keeps the total of the last load(0) while paging as new blocks arrive', async () => {
    serve(100)
    const pages = useActivityPages(() => OWN)
    await pages.load(0)
    getAccountInfo.mockResolvedValue({ blockCount: 105 })

    await pages.load(1)

    expect(pages.total.value).toBe(100)
    expect(pages.range.value).toEqual({ from: 90, to: 81 })

    await pages.load(0)
    expect(pages.total.value).toBe(105)
  })

  it('ignores out-of-range pages and a missing address', async () => {
    serve(1482)
    const pages = useActivityPages(() => OWN)
    await pages.load(0)
    getAccountBlocksByHeight.mockClear()

    await pages.load(-1)
    await pages.load(149)

    expect(getAccountBlocksByHeight).not.toHaveBeenCalled()
    expect(pages.page.value).toBe(0)

    const none = useActivityPages(() => null)
    await none.load(0)
    expect(getAccountInfo).toHaveBeenCalledTimes(1)
  })

  it('ignores page 1 before any load(0)', async () => {
    serve(100)
    const pages = useActivityPages(() => OWN)

    await pages.load(1)

    expect(getAccountBlocksByHeight).not.toHaveBeenCalled()
  })

  it('keeps the previous rows, page and total when a page change fails', async () => {
    serve(100)
    const pages = useActivityPages(() => OWN)
    await pages.load(0)
    getAccountBlocksByHeight.mockRejectedValueOnce(new Error('node down'))

    await pages.load(1)

    expect(pages.error.value).toBe('node down')
    expect(pages.page.value).toBe(0)
    expect(pages.total.value).toBe(100)
    expect(heights(pages)[0]).toBe(100)
    expect(pages.isLoading.value).toBe(false)
  })

  it('falls back to a fixed message for a non-Error failure and clears it on success', async () => {
    getAccountInfo.mockRejectedValueOnce('boom')
    const pages = useActivityPages(() => OWN)

    await pages.load(0)
    expect(pages.error.value).toBe('Failed to load activity')

    serve(5)
    await pages.load(0)
    expect(pages.error.value).toBeNull()
  })

  it('drops a slower earlier load that resolves after a later one', async () => {
    let resolveOld!: (value: unknown) => void
    getAccountInfo
      .mockReturnValueOnce(new Promise((resolve) => (resolveOld = resolve)))
      .mockResolvedValueOnce({ blockCount: 50 })
    getAccountBlocksByHeight.mockImplementation(async (_a: string, low: number, count: number) =>
      asc(low, count)
    )
    const pages = useActivityPages(() => OWN)

    const older = pages.load(0)
    await pages.load(0)
    resolveOld({ blockCount: 20 })
    await older

    expect(pages.total.value).toBe(50)
    expect(heights(pages)[0]).toBe(50)
    expect(pages.isLoading.value).toBe(false)
  })

  it('stays loading until the latest call settles', async () => {
    let resolveFirst!: (value: unknown) => void
    getAccountInfo
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise(() => {}))
    const pages = useActivityPages(() => OWN)

    const first = pages.load(0)
    void pages.load(0)
    resolveFirst({ blockCount: 0 })
    await first

    expect(pages.isLoading.value).toBe(true)
  })
})

describe('recentRecipients', () => {
  const CONTRACT = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
  const to = (address: string, over: Record<string, unknown> = {}) =>
    block({ toAddress: { toString: () => address }, ...over })
  const A = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'
  const B = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'
  const C = 'z1qr4pexnnfxhxu5pk8z4kg5zpd4cvcmq7ehgtvk'
  const D = 'z1qpsjv3wzkrpmgqn7h4wwqe9wrzgh8jkt3pk4eg'

  it('returns 3 distinct user-send targets newest first, skipping receives and contract calls', () => {
    const blocks = [
      to(A),
      to(B, { blockType: USER_RECEIVE }),
      to(CONTRACT),
      to(A),
      to(C),
      to(B),
      to(D),
    ]

    expect(recentRecipients(blocks, 3)).toEqual([A, C, B])
  })

  it('returns fewer than the limit when there are fewer targets', () => {
    expect(recentRecipients([to(A), to(A)], 3)).toEqual([A])
    expect(recentRecipients([], 3)).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'

const mocks = vi.hoisted(() => ({
  getByOwner: vi.fn(),
  findToken: vi.fn(),
  issueBlock: vi.fn(),
  mintBlock: vi.fn(),
  burnBlock: vi.fn(),
  updateBlock: vi.fn(),
}))

vi.mock('../contract-send', () => ({ sendContractCall: vi.fn() }))
vi.mock('../token-service', () => ({
  TokenService: { getInstance: () => mocks },
}))

import { sendContractCall } from '../contract-send'
import { TOKEN_CHANGED_MESSAGE, useOwnedTokens } from './useOwnedTokens'

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void }
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tok = (symbol: string) => ({ symbol }) as never
const answer = (count: number, ...symbols: string[]) => ({ count, list: symbols.map(tok) })

beforeEach(() => {
  mocks.getByOwner.mockReset()
  mocks.findToken.mockReset()
  mocks.issueBlock.mockReset()
  mocks.mintBlock.mockReset()
  mocks.burnBlock.mockReset()
  mocks.updateBlock.mockReset()
  vi.mocked(sendContractCall).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('loadOwned', () => {
  it('sets the list and count for the address with a single default-page call', async () => {
    mocks.getByOwner.mockResolvedValue(answer(2, 'A', 'B'))
    const t = useOwnedTokens()

    await t.loadOwned('z1a')

    expect(mocks.getByOwner).toHaveBeenCalledWith('z1a')
    expect(t.owned.value).toHaveLength(2)
    expect(t.ownedFor.value).toBe('z1a')
    expect(t.ownedCount.value).toBe(2)
    expect(t.ownedCountFor.value).toBe('z1a')
    expect(t.isLoading.value).toBe(false)
    expect(t.error.value).toBeNull()
  })

  it('keeps the true total when the list is capped', async () => {
    const list = Array.from({ length: 1024 }, (_, i) => tok(`T${i}`))
    mocks.getByOwner.mockResolvedValue({ count: 5000, list })
    const t = useOwnedTokens()

    await t.loadOwned('z1cap')

    expect(t.owned.value).toHaveLength(1024)
    expect(t.ownedCount.value).toBe(5000)
  })

  it('lets the newest call win when an older one resolves last', async () => {
    const a = deferred<ReturnType<typeof answer>>()
    const b = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const t = useOwnedTokens()

    const first = t.loadOwned('z1a')
    const second = t.loadOwned('z1b')
    b.resolve(answer(1, 'B'))
    await second
    a.resolve(answer(7, 'A1', 'A2'))
    await first

    expect(t.ownedFor.value).toBe('z1b')
    expect(t.owned.value).toHaveLength(1)
    expect(t.ownedCountFor.value).toBe('z1b')
    expect(t.ownedCount.value).toBe(1)
    expect(t.isLoading.value).toBe(false)
  })

  it('does not clear loading when an older call finishes first', async () => {
    const a = deferred<ReturnType<typeof answer>>()
    const b = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const t = useOwnedTokens()

    const first = t.loadOwned('z1a')
    const second = t.loadOwned('z1b')
    a.resolve(answer(1, 'A'))
    await first

    expect(t.isLoading.value).toBe(true)
    b.resolve(answer(1, 'B'))
    await second
    expect(t.isLoading.value).toBe(false)
  })

  it('ignores a stale failure after a newer success', async () => {
    const a = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(a.promise).mockResolvedValueOnce(answer(1, 'B'))
    const t = useOwnedTokens()

    const first = t.loadOwned('z1a')
    await t.loadOwned('z1b')
    a.reject(new Error('late'))
    await first

    expect(t.error.value).toBeNull()
    expect(t.ownedFor.value).toBe('z1b')
  })

  it('records the error, empties the list and keeps the count on failure', async () => {
    mocks.getByOwner.mockResolvedValueOnce(answer(4, 'A')).mockRejectedValueOnce(new Error('boom'))
    const t = useOwnedTokens()
    await t.loadOwned('z1ok')

    await t.loadOwned('z1fail')

    expect(t.error.value).toBe('boom')
    expect(t.owned.value).toEqual([])
    expect(t.ownedFor.value).toBeNull()
    expect(t.ownedCount.value).toBe(4)
    expect(t.ownedCountFor.value).toBe('z1ok')
    expect(t.isLoading.value).toBe(false)
  })

  it('uses a fallback message for a non-Error rejection', async () => {
    mocks.getByOwner.mockRejectedValueOnce('x')
    const t = useOwnedTokens()

    await t.loadOwned('z1x')

    expect(t.error.value).toBe('Failed to load tokens')
  })
})

describe('loadOwnedCount', () => {
  it('reads one row and leaves the list state alone', async () => {
    mocks.getByOwner.mockResolvedValueOnce(answer(1, 'L'))
    const t = useOwnedTokens()
    await t.loadOwned('z1list')
    mocks.getByOwner.mockResolvedValueOnce(answer(9, 'X'))

    await t.loadOwnedCount('z1count')

    expect(mocks.getByOwner).toHaveBeenLastCalledWith('z1count', 0, 1)
    expect(t.ownedCount.value).toBe(9)
    expect(t.ownedCountFor.value).toBe('z1count')
    expect(t.ownedFor.value).toBe('z1list')
    expect(t.owned.value).toHaveLength(1)
    expect(t.isLoading.value).toBe(false)
  })

  it('loses to a later loadOwned that resolves first', async () => {
    const c = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(c.promise).mockResolvedValueOnce(answer(3, 'B'))
    const t = useOwnedTokens()

    const count = t.loadOwnedCount('z1a')
    await t.loadOwned('z1b')
    c.resolve(answer(99))
    await count

    expect(t.ownedCountFor.value).toBe('z1b')
    expect(t.ownedCount.value).toBe(3)
  })

  it('loses to a later loadOwnedCount that resolves first', async () => {
    const a = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(a.promise).mockResolvedValueOnce(answer(2))
    const t = useOwnedTokens()

    const first = t.loadOwnedCount('z1a')
    await t.loadOwnedCount('z1b')
    a.resolve(answer(50))
    await first

    expect(t.ownedCountFor.value).toBe('z1b')
    expect(t.ownedCount.value).toBe(2)
  })

  it('clears the count on failure, resolves and does not log', async () => {
    mocks.getByOwner.mockResolvedValueOnce(answer(5)).mockRejectedValueOnce(new Error('x'))
    const t = useOwnedTokens()
    await t.loadOwnedCount('z1a')
    vi.mocked(console.error).mockClear()

    await expect(t.loadOwnedCount('z1b')).resolves.toBeUndefined()

    expect(t.ownedCount.value).toBeNull()
    expect(t.ownedCountFor.value).toBeNull()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('ignores a stale failure after a newer success', async () => {
    const a = deferred<ReturnType<typeof answer>>()
    mocks.getByOwner.mockReturnValueOnce(a.promise).mockResolvedValueOnce(answer(6))
    const t = useOwnedTokens()

    const first = t.loadOwnedCount('z1a')
    await t.loadOwnedCount('z1b')
    a.reject(new Error('late'))
    await first

    expect(t.ownedCount.value).toBe(6)
    expect(t.ownedCountFor.value).toBe('z1b')
  })
})

describe('findToken', () => {
  it('returns the service token', async () => {
    const token = tok('ZNN')
    mocks.findToken.mockResolvedValue(token)

    expect(await useOwnedTokens().findToken('zts1')).toBe(token)
  })

  it('returns null unchanged', async () => {
    mocks.findToken.mockResolvedValue(null)

    expect(await useOwnedTokens().findToken('zts1')).toBeNull()
  })

  it('rejects with the service error', async () => {
    mocks.findToken.mockRejectedValue(new Error('network down'))

    await expect(useOwnedTokens().findToken('zts1')).rejects.toThrow('network down')
  })
})

describe('issue', () => {
  const wallet = { baseAddress: 'z1base' } as never
  const params = {
    name: 'MyToken',
    symbol: 'MYT',
    domain: '',
    totalSupply: 1n,
    maxSupply: 2n,
    decimals: 8,
    mintable: true,
    burnable: true,
    utility: false,
  }
  const meta = { kind: 'contract', title: 'Token · Issue MYT' } as never

  it('sends the built block through the shared contract send with no beforePublish', async () => {
    const block = { id: 'issue-block' }
    const sent = { hash: 'h' }
    mocks.issueBlock.mockReturnValue(block)
    vi.mocked(sendContractCall).mockResolvedValue(sent as never)

    const result = await useOwnedTokens().issue(wallet, 'z1me', params, meta)

    expect(result).toBe(sent)
    expect(mocks.issueBlock).toHaveBeenCalledTimes(1)
    expect(mocks.issueBlock).toHaveBeenCalledWith(params)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
    const input = vi.mocked(sendContractCall).mock.calls[0][0]
    expect(input).toEqual({
      wallet,
      from: 'z1me',
      block,
      meta,
      activity: 'Issuing token',
    })
    expect('beforePublish' in input).toBe(false)
  })

  it('fails and sends nothing when the block cannot be built', async () => {
    mocks.issueBlock.mockImplementation(() => {
      throw new Error('bad params')
    })

    await expect(async () => useOwnedTokens().issue(wallet, 'z1me', params, meta)).rejects.toThrow(
      'bad params'
    )
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('rejects with the send error unchanged', async () => {
    mocks.issueBlock.mockReturnValue({})
    const err = new Error('boom')
    vi.mocked(sendContractCall).mockRejectedValue(err)

    await expect(useOwnedTokens().issue(wallet, 'z1me', params, meta)).rejects.toBe(err)
  })
})

const ME = 'z1me'
const OTHER = 'z1other'
const ZTS = 'zts1testtokenxxxxxxxxxx'
const wallet = { baseAddress: 'z1base' } as never
const meta = { kind: 'contract', title: 'Token' } as never
const NOTHING_SENT_READ = "Couldn't read this token from the node. Nothing was sent."

function chainToken(over: Record<string, unknown> = {}) {
  return {
    owner: { toString: () => ME },
    isMintable: true,
    isBurnable: false,
    totalSupply: 100n,
    maxSupply: 200n,
    ...over,
  } as never
}

describe('mint', () => {
  const params = { tokenStandard: ZTS, amount: 100n, receiveAddress: ME }

  it('sends the built block once with the activity and no beforePublish', async () => {
    const block = { id: 'mint-block' }
    const sent = { hash: 'h' }
    mocks.findToken.mockResolvedValue(chainToken())
    mocks.mintBlock.mockReturnValue(block)
    vi.mocked(sendContractCall).mockResolvedValue(sent as never)

    expect(await useOwnedTokens().mint(wallet, ME, params, meta)).toBe(sent)

    expect(mocks.findToken).toHaveBeenCalledWith(ZTS)
    expect(mocks.mintBlock).toHaveBeenCalledWith(params)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
    const input = vi.mocked(sendContractCall).mock.calls[0][0]
    expect(input).toEqual({ wallet, from: ME, block, meta, activity: 'Minting tokens' })
    expect('beforePublish' in input).toBe(false)
  })

  it('sends the exact remaining amount', async () => {
    mocks.findToken.mockResolvedValue(chainToken({ totalSupply: 100n, maxSupply: 200n }))
    mocks.mintBlock.mockReturnValue({})
    vi.mocked(sendContractCall).mockResolvedValue({} as never)

    await useOwnedTokens().mint(wallet, ME, params, meta)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the token is gone', null],
    ['the owner changed', chainToken({ owner: { toString: () => OTHER } })],
    ['minting was turned off', chainToken({ isMintable: false })],
    ['the supply grew by one raw unit', chainToken({ totalSupply: 101n })],
    ['the max supply fell', chainToken({ maxSupply: 199n })],
  ])('refuses and sends nothing when %s', async (_name, token) => {
    mocks.findToken.mockResolvedValue(token)

    await expect(useOwnedTokens().mint(wallet, ME, params, meta)).rejects.toThrow(
      TOKEN_CHANGED_MESSAGE
    )
    expect(mocks.mintBlock).not.toHaveBeenCalled()
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('compares supplies as bigint at 2^255 - 1', async () => {
    const max = 2n ** 255n - 1n
    mocks.mintBlock.mockReturnValue({})
    vi.mocked(sendContractCall).mockResolvedValue({} as never)
    mocks.findToken.mockResolvedValue(chainToken({ totalSupply: 0n, maxSupply: max }))
    await useOwnedTokens().mint(wallet, ME, { ...params, amount: max }, meta)
    expect(sendContractCall).toHaveBeenCalledTimes(1)

    mocks.findToken.mockResolvedValue(chainToken({ totalSupply: 1n, maxSupply: max }))
    await expect(
      useOwnedTokens().mint(wallet, ME, { ...params, amount: max }, meta)
    ).rejects.toThrow(TOKEN_CHANGED_MESSAGE)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the read fails', async () => {
    mocks.findToken.mockRejectedValue(new Error('down'))

    await expect(useOwnedTokens().mint(wallet, ME, params, meta)).rejects.toThrow(NOTHING_SENT_READ)
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('rejects with the send error unchanged', async () => {
    const err = new Error('boom')
    mocks.findToken.mockResolvedValue(chainToken())
    mocks.mintBlock.mockReturnValue({})
    vi.mocked(sendContractCall).mockRejectedValue(err)

    await expect(useOwnedTokens().mint(wallet, ME, params, meta)).rejects.toBe(err)
  })
})

describe('burn', () => {
  const params = { tokenStandard: ZTS, amount: 5n }

  it('sends the built block once for the owner of a token that is not burnable', async () => {
    const block = { id: 'burn-block' }
    mocks.findToken.mockResolvedValue(chainToken({ isBurnable: false }))
    mocks.burnBlock.mockReturnValue(block)
    vi.mocked(sendContractCall).mockResolvedValue({} as never)

    await useOwnedTokens().burn(wallet, ME, params, meta)

    expect(mocks.burnBlock).toHaveBeenCalledWith(params)
    const input = vi.mocked(sendContractCall).mock.calls[0][0]
    expect(input).toEqual({ wallet, from: ME, block, meta, activity: 'Burning tokens' })
    expect('beforePublish' in input).toBe(false)
  })

  it('lets a non-owner burn a burnable token', async () => {
    mocks.findToken.mockResolvedValue(
      chainToken({ isBurnable: true, owner: { toString: () => OTHER } })
    )
    mocks.burnBlock.mockReturnValue({})
    vi.mocked(sendContractCall).mockResolvedValue({} as never)

    await useOwnedTokens().burn(wallet, ME, params, meta)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
  })

  it('refuses a non-owner on a token that is not burnable', async () => {
    mocks.findToken.mockResolvedValue(
      chainToken({ isBurnable: false, owner: { toString: () => OTHER } })
    )

    await expect(useOwnedTokens().burn(wallet, ME, params, meta)).rejects.toThrow(
      TOKEN_CHANGED_MESSAGE
    )
    expect(mocks.burnBlock).not.toHaveBeenCalled()
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('refuses when the token is gone', async () => {
    mocks.findToken.mockResolvedValue(null)

    await expect(useOwnedTokens().burn(wallet, ME, params, meta)).rejects.toThrow(
      TOKEN_CHANGED_MESSAGE
    )
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it.each([
    ['ZNN', ZNN_ZTS.toString()],
    ['QSR', QSR_ZTS.toString()],
  ])('refuses %s before any read', async (_name, zts) => {
    await expect(
      useOwnedTokens().burn(wallet, ME, { tokenStandard: zts, amount: 1n }, meta)
    ).rejects.toThrow("ZNN and QSR can't be burned from this wallet. Nothing was sent.")
    expect(mocks.findToken).not.toHaveBeenCalled()
    expect(mocks.burnBlock).not.toHaveBeenCalled()
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('sends nothing when the read fails', async () => {
    mocks.findToken.mockRejectedValue(new Error('down'))

    await expect(useOwnedTokens().burn(wallet, ME, params, meta)).rejects.toThrow(NOTHING_SENT_READ)
    expect(sendContractCall).not.toHaveBeenCalled()
  })
})

describe('update', () => {
  const loaded = { owner: ME, mintable: true, burnable: false }
  const params = { tokenStandard: ZTS, owner: OTHER, mintable: true, burnable: true }

  it('sends the built block once when nothing moved', async () => {
    const block = { id: 'update-block' }
    mocks.findToken.mockResolvedValue(chainToken())
    mocks.updateBlock.mockReturnValue(block)
    vi.mocked(sendContractCall).mockResolvedValue({} as never)

    await useOwnedTokens().update(wallet, ME, params, loaded, meta)

    expect(mocks.updateBlock).toHaveBeenCalledWith(params)
    const input = vi.mocked(sendContractCall).mock.calls[0][0]
    expect(input).toEqual({ wallet, from: ME, block, meta, activity: 'Updating token' })
    expect('beforePublish' in input).toBe(false)
  })

  it.each([
    ['the token is gone', null],
    ['the owner is no longer this account', chainToken({ owner: { toString: () => OTHER } })],
    ['minting was turned off elsewhere', chainToken({ isMintable: false })],
    ['burnable was changed elsewhere', chainToken({ isBurnable: true })],
  ])('refuses and sends nothing when %s', async (_name, token) => {
    mocks.findToken.mockResolvedValue(token)

    await expect(useOwnedTokens().update(wallet, ME, params, loaded, meta)).rejects.toThrow(
      TOKEN_CHANGED_MESSAGE
    )
    expect(mocks.updateBlock).not.toHaveBeenCalled()
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('refuses when the dialog showed a different owner than the node has now', async () => {
    mocks.findToken.mockResolvedValue(chainToken())

    await expect(
      useOwnedTokens().update(wallet, ME, params, { ...loaded, owner: 'z1stale' }, meta)
    ).rejects.toThrow(TOKEN_CHANGED_MESSAGE)
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('refuses when the dialog showed other flags than the node has now', async () => {
    mocks.findToken.mockResolvedValue(chainToken())

    await expect(
      useOwnedTokens().update(wallet, ME, params, { ...loaded, burnable: true }, meta)
    ).rejects.toThrow(TOKEN_CHANGED_MESSAGE)
    await expect(
      useOwnedTokens().update(wallet, ME, params, { ...loaded, mintable: false }, meta)
    ).rejects.toThrow(TOKEN_CHANGED_MESSAGE)
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('refuses turning minting back on and sends nothing', async () => {
    mocks.findToken.mockResolvedValue(chainToken({ isMintable: false }))

    await expect(
      useOwnedTokens().update(
        wallet,
        ME,
        { ...params, mintable: true },
        { ...loaded, mintable: false },
        meta
      )
    ).rejects.toThrow("Minting can't be turned back on. Nothing was sent.")
    expect(sendContractCall).not.toHaveBeenCalled()
  })

  it('lets minting be turned off', async () => {
    mocks.findToken.mockResolvedValue(chainToken())
    mocks.updateBlock.mockReturnValue({})
    vi.mocked(sendContractCall).mockResolvedValue({} as never)

    await useOwnedTokens().update(wallet, ME, { ...params, mintable: false }, loaded, meta)
    expect(sendContractCall).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the read fails', async () => {
    mocks.findToken.mockRejectedValue(new Error('down'))

    await expect(useOwnedTokens().update(wallet, ME, params, loaded, meta)).rejects.toThrow(
      NOTHING_SENT_READ
    )
    expect(sendContractCall).not.toHaveBeenCalled()
  })
})

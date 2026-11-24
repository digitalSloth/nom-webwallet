import { describe, expect, it, vi } from 'vitest'
import {
  PLASMA_ADDRESS,
  QSR_ZTS,
  TOKEN_ADDRESS,
  Zenon,
  ZNN_ZTS as SDK_ZNN_ZTS,
} from 'znn-typescript-sdk'
import { TOKEN_OWNED_PAGE_SIZE } from '@/config'

vi.mock('@/core/zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))

import { decodeContractCall } from './contract-call'
import { TokenService } from './token-service'
import type { BurnParams, IssueParams, MintParams, UpdateParams } from './token-service'

const ZNN_ZTS = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const addr = PLASMA_ADDRESS.toString()

function makeService(token: { getByOwner?: unknown; getByZts?: unknown }) {
  const fake = {
    getZenon: () => ({ embedded: { token } }),
    ensureInitialized: async () => {},
  }
  return new TokenService(fake as never)
}

describe('TokenService.getByOwner', () => {
  it('reads one page of the cap size from index 0 by default', async () => {
    const getByOwner = vi.fn().mockResolvedValue({ count: 3, list: [] })
    const result = await makeService({ getByOwner }).getByOwner(addr)

    expect(result).toEqual({ count: 3, list: [] })
    const [address, index, size] = getByOwner.mock.calls[0]
    expect(address.toString()).toBe(addr)
    expect(index).toBe(0)
    expect(size).toBe(TOKEN_OWNED_PAGE_SIZE)
    expect(TOKEN_OWNED_PAGE_SIZE).toBe(1024)
  })

  it('passes explicit page arguments through', async () => {
    const getByOwner = vi.fn().mockResolvedValue({ count: 0, list: [] })
    await makeService({ getByOwner }).getByOwner(addr, 0, 1)

    expect(getByOwner.mock.calls[0].slice(1)).toEqual([0, 1])
  })

  it('rejects with the SDK error', async () => {
    const getByOwner = vi.fn().mockRejectedValue(new Error('network down'))

    await expect(makeService({ getByOwner }).getByOwner(addr)).rejects.toThrow('network down')
  })

  it('rejects for an invalid address without calling the SDK', async () => {
    const getByOwner = vi.fn()

    await expect(makeService({ getByOwner }).getByOwner('nope')).rejects.toThrow()
    expect(getByOwner).not.toHaveBeenCalled()
  })
})

describe('TokenService.findToken', () => {
  it('passes a parsed token standard and returns the token', async () => {
    const token = { symbol: 'ZNN' }
    const getByZts = vi.fn().mockResolvedValue(token)

    expect(await makeService({ getByZts }).findToken(ZNN_ZTS)).toBe(token)
    expect(getByZts.mock.calls[0][0].toString()).toBe(ZNN_ZTS)
  })

  it('returns null when the node has no such token', async () => {
    const getByZts = vi.fn().mockResolvedValue(null)

    expect(await makeService({ getByZts }).findToken(ZNN_ZTS)).toBeNull()
  })

  it('rejects with the network error instead of returning null', async () => {
    const getByZts = vi.fn().mockRejectedValue(new Error('network down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(makeService({ getByZts }).findToken(ZNN_ZTS)).rejects.toThrow('network down')
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('rejects for unparseable text without calling the SDK', async () => {
    const getByZts = vi.fn()

    await expect(makeService({ getByZts }).findToken('not-a-zts')).rejects.toThrow()
    expect(getByZts).not.toHaveBeenCalled()
  })
})

describe('TokenService.issueBlock', () => {
  const service = makeService(Zenon.getInstance().embedded.token as never)
  const params: IssueParams = {
    name: 'MyToken',
    symbol: 'MYT',
    domain: 'example.com',
    totalSupply: 100_000_000_000n,
    maxSupply: 200_000_000_000n,
    decimals: 8,
    mintable: true,
    burnable: false,
    utility: true,
  }
  const decoded = (p: IssueParams) => {
    const block = service.issueBlock(p)
    const call = decodeContractCall(block.toAddress.toString(), block.data)
    return { block, call, arg: (name: string) => call?.args.find((a) => a.name === name)?.value }
  }

  it('sends to the token contract in ZNN with the fee as the bigint 100_000_000n', () => {
    const { block } = decoded(params)

    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(block.tokenStandard.toString()).toBe(SDK_ZNN_ZTS.toString())
    expect(block.amount).toBe(100_000_000n)
    expect(typeof block.amount).toBe('bigint')
  })

  it('encodes IssueToken with the name, symbol, domain, decimals, flags and supplies', () => {
    const { call, arg } = decoded(params)

    expect(call?.method).toBe('IssueToken')
    expect(arg('tokenName')).toBe('MyToken')
    expect(arg('tokenSymbol')).toBe('MYT')
    expect(arg('tokenDomain')).toBe('example.com')
    expect(arg('totalSupply')).toBe('100000000000')
    expect(arg('maxSupply')).toBe('200000000000')
    expect(Number(arg('decimals'))).toBe(8)
    expect(String(arg('isMintable'))).toBe('true')
    expect(String(arg('isBurnable'))).toBe('false')
    expect(String(arg('isUtility'))).toBe('true')
  })

  it('encodes the maximum supply at 18 decimals without loss', () => {
    const max = 2n ** 255n - 1n
    const { block, arg } = decoded({ ...params, totalSupply: max, maxSupply: max, decimals: 18 })

    expect(arg('totalSupply')).toBe(max.toString())
    expect(arg('maxSupply')).toBe(max.toString())
    expect(Number(arg('decimals'))).toBe(18)
    expect(block.amount).toBe(100_000_000n)
  })

  it('encodes an empty domain and a zero initial supply', () => {
    const { arg } = decoded({ ...params, domain: '', totalSupply: 0n })

    expect(arg('tokenDomain')).toBe('')
    expect(arg('totalSupply')).toBe('0')
  })
})

describe('TokenService mint, burn and update blocks', () => {
  const service = makeService(Zenon.getInstance().embedded.token as never)
  const zts = QSR_ZTS.toString()
  const max = 2n ** 255n - 1n
  const decode = (block: { toAddress: { toString(): string }; data: Uint8Array }) => {
    const call = decodeContractCall(block.toAddress.toString(), block.data)
    return { call, arg: (name: string) => call?.args.find((a) => a.name === name)?.value }
  }

  const mint: MintParams = { tokenStandard: zts, amount: 15n, receiveAddress: addr }
  it('encodes Mint to the token contract with the args and 0 ZNN', () => {
    const block = service.mintBlock(mint)
    const { call, arg } = decode(block)

    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(call?.method).toBe('Mint')
    expect(arg('tokenStandard')).toBe(zts)
    expect(arg('amount')).toBe('15')
    expect(arg('receiveAddress')).toBe(addr)
    expect(block.amount).toBe(0n)
    expect(block.tokenStandard.toString()).toBe(SDK_ZNN_ZTS.toString())
  })

  it('encodes a mint of 2^255 - 1 without loss', () => {
    expect(decode(service.mintBlock({ ...mint, amount: max })).arg('amount')).toBe(max.toString())
  })

  const burn: BurnParams = { tokenStandard: zts, amount: 7n }
  it('encodes an empty Burn that carries the amount in the burned token', () => {
    const block = service.burnBlock(burn)
    const { call } = decode(block)

    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(call?.method).toBe('Burn')
    expect(call?.args).toEqual([])
    expect(block.amount).toBe(burn.amount)
    expect(typeof block.amount).toBe('bigint')
    expect(block.tokenStandard.toString()).toBe(zts)
  })

  it('carries a burn of 2^255 - 1 without loss', () => {
    const block = service.burnBlock({ ...burn, amount: max })
    expect(block.amount).toBe(max)
  })

  const update: UpdateParams = { tokenStandard: zts, owner: addr, mintable: false, burnable: true }
  it('encodes UpdateToken with the owner and both flags and 0 ZNN', () => {
    const block = service.updateBlock(update)
    const { call, arg } = decode(block)

    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(call?.method).toBe('UpdateToken')
    expect(arg('tokenStandard')).toBe(zts)
    expect(arg('owner')).toBe(addr)
    expect(String(arg('isMintable'))).toBe('false')
    expect(String(arg('isBurnable'))).toBe('true')
    expect(block.amount).toBe(0n)
    expect(block.tokenStandard.toString()).toBe(SDK_ZNN_ZTS.toString())
  })

  it('does not swap the two flags', () => {
    const { arg } = decode(service.updateBlock({ ...update, mintable: true, burnable: false }))
    expect(String(arg('isMintable'))).toBe('true')
    expect(String(arg('isBurnable'))).toBe('false')
  })

  it('throws for an invalid token standard or address', () => {
    expect(() => service.mintBlock({ ...mint, tokenStandard: 'nope' })).toThrow()
    expect(() => service.mintBlock({ ...mint, receiveAddress: 'z1nope' })).toThrow()
    expect(() => service.burnBlock({ ...burn, tokenStandard: 'nope' })).toThrow()
    expect(() => service.updateBlock({ ...update, owner: 'z1nope' })).toThrow()
  })
})

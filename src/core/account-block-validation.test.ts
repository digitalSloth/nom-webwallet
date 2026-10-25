import { describe, expect, it } from 'vitest'

import {
  accountBlockProblem,
  addressProblem,
  MAX_DATA_BYTES,
  sendTransactionParamsProblem,
  tokenStandardProblem,
} from '@/core/account-block-validation'

const ADDRESS = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'
const ADDRESS_19_BYTES = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqg4tnrnm'
const WRONG_PREFIX_ADDRESS = 'x1qyqszqgpqyqszqgpqyqszqgpqyqszqgp8dwm67'
const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const MAX_AMOUNT = (2n ** 255n - 1n).toString()

function send(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { blockType: 2, toAddress: ADDRESS, tokenStandard: ZNN, amount: '1', ...overrides }
}

function base64OfBytes(length: number): string {
  return Buffer.alloc(length, 7).toString('base64')
}

describe('addressProblem', () => {
  it('accepts a 20-byte z address', () => {
    expect(addressProblem(ADDRESS)).toBeNull()
  })

  it('rejects the wrong bech32 prefix', () => {
    expect(addressProblem(WRONG_PREFIX_ADDRESS)).toBe("Invalid address prefix 'x'.")
  })

  it('rejects a core that is not 20 bytes', () => {
    expect(addressProblem(ADDRESS_19_BYTES)).toBe('Invalid address length.')
  })

  it('rejects a bad checksum and non-strings', () => {
    expect(addressProblem(ADDRESS.slice(0, -1) + 'q')).toBe('Invalid bech32 encoding for address.')
    expect(addressProblem(42)).toBe('Address must be a string.')
  })
})

describe('tokenStandardProblem', () => {
  it('accepts ZNN and rejects an address in its place', () => {
    expect(tokenStandardProblem(ZNN)).toBeNull()
    expect(tokenStandardProblem(ADDRESS)).toBe("Invalid token standard prefix 'z'.")
  })
})

describe('accountBlockProblem', () => {
  it('accepts a minimal send block', () => {
    expect(accountBlockProblem(send())).toBeNull()
  })

  it.each([0, 1, 4, 5, '2', undefined])('rejects block type %s', (blockType) => {
    expect(accountBlockProblem(send({ blockType }))).toMatch(/Unsupported block type/)
  })

  it('rejects non-object input', () => {
    expect(accountBlockProblem(null)).toBe('Account block must be an object.')
    expect(accountBlockProblem([send()])).toBe('Account block must be an object.')
  })

  describe('amount', () => {
    it.each(['0', '100000000', 100000000, MAX_AMOUNT])('accepts %s', (amount) => {
      expect(accountBlockProblem(send({ amount }))).toBeNull()
    })

    it.each(['-1', '1.5', '1e8', '', ' 1', '0x10', -1, 1.5])('rejects %s', (amount) => {
      expect(accountBlockProblem(send({ amount }))).toMatch(/non-negative integer/)
    })

    it('rejects a JSON number beyond the safe-integer range', () => {
      expect(accountBlockProblem(send({ amount: 2 ** 53 }))).toMatch(/pass it as a string/)
    })

    it('rejects an amount wider than 255 bits, as go-zenon does', () => {
      expect(accountBlockProblem(send({ amount: (2n ** 255n).toString() }))).toBe(
        'Amount is too large.'
      )
    })

    it('rejects an oversized string before parsing it', () => {
      expect(accountBlockProblem(send({ amount: '9'.repeat(100_000) }))).toBe(
        'Amount is too large.'
      )
    })
  })

  describe('data', () => {
    it('accepts base64 up to the protocol limit', () => {
      expect(accountBlockProblem(send({ data: base64OfBytes(MAX_DATA_BYTES) }))).toBeNull()
      expect(accountBlockProblem(send({ data: base64OfBytes(MAX_DATA_BYTES - 1) }))).toBeNull()
    })

    it('rejects data one byte over the limit', () => {
      expect(accountBlockProblem(send({ data: base64OfBytes(MAX_DATA_BYTES + 1) }))).toMatch(
        /too large/
      )
    })

    it('rejects an oversized string before checking its format', () => {
      expect(accountBlockProblem(send({ data: 'A'.repeat(1_000_000) }))).toMatch(/too large/)
    })

    it('rejects 0x-prefixed hex and malformed base64', () => {
      expect(accountBlockProblem(send({ data: '0xdeadbeef' }))).toBe('Block data must be base64.')
      expect(accountBlockProblem(send({ data: 'abc' }))).toBe('Block data must be base64.')
      expect(accountBlockProblem(send({ data: 'ab$=' }))).toBe('Block data must be base64.')
    })
  })

  describe('receive blocks', () => {
    const fromBlockHash = 'ab'.repeat(32)

    it('accepts a fromBlockHash and ignores send-only fields', () => {
      expect(accountBlockProblem({ blockType: 3, fromBlockHash })).toBeNull()
      expect(accountBlockProblem({ blockType: 3, fromBlockHash, amount: 'garbage' })).toBeNull()
    })

    it('rejects a missing or short fromBlockHash', () => {
      expect(accountBlockProblem({ blockType: 3 })).toMatch(/fromBlockHash/)
      expect(accountBlockProblem({ blockType: 3, fromBlockHash: 'ab'.repeat(31) })).toMatch(
        /fromBlockHash/
      )
    })

    it('rejects data on a receive', () => {
      expect(accountBlockProblem({ blockType: 3, fromBlockHash, data: 'AAAA' })).toBe(
        'Receive blocks cannot carry data.'
      )
    })
  })
})

describe('sendTransactionParamsProblem', () => {
  it('accepts {to, tokenStandard, amount} and applies the same amount bound', () => {
    expect(
      sendTransactionParamsProblem({ to: ADDRESS, tokenStandard: ZNN, amount: '5' })
    ).toBeNull()
    expect(
      sendTransactionParamsProblem({
        to: ADDRESS,
        tokenStandard: ZNN,
        amount: (2n ** 255n).toString(),
      })
    ).toBe('Amount is too large.')
  })
})

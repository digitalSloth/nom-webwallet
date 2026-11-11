import { describe, expect, it } from 'vitest'

import {
  InvalidParamsError,
  parseAccountBlockJson,
  parseSendTransactionParams,
} from '@/core/account-block-params'

const ADDRESS = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'
const OTHER_ADDRESS = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'
const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
const BOUND_CHAIN_ID = 3

// Every field the wallet fills in or computes itself. A dApp that sends
// them must not be able to put any of them into the signed digest.
const DAPP_CHOSEN_FIELDS = {
  version: 7,
  chainIdentifier: 999,
  address: OTHER_ADDRESS,
  height: 42,
  previousHash: 'cd'.repeat(32),
  momentumAcknowledged: { hash: 'ef'.repeat(32), height: 100 },
  fusedPlasma: 21000,
  difficulty: 5,
  nonce: '00000000000000ff',
  publicKey: Buffer.alloc(32, 1).toString('base64'),
  signature: Buffer.alloc(64, 2).toString('base64'),
  hash: 'ab'.repeat(32),
}

function send(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { blockType: 2, toAddress: ADDRESS, tokenStandard: ZNN, amount: '1', ...overrides }
}

describe('parseAccountBlockJson', () => {
  it('takes the chain id from the approval, never from the dApp', () => {
    const block = parseAccountBlockJson(send(DAPP_CHOSEN_FIELDS), BOUND_CHAIN_ID)

    expect(block.chainIdentifier).toBe(BOUND_CHAIN_ID)
  })

  it('builds the same send block whatever wallet-owned fields the dApp adds', () => {
    const minimal = parseAccountBlockJson(send(), BOUND_CHAIN_ID)
    const withExtras = parseAccountBlockJson(send(DAPP_CHOSEN_FIELDS), BOUND_CHAIN_ID)

    expect(withExtras.toJson()).toEqual(minimal.toJson())
  })

  it('keeps the send fields the dApp is allowed to choose', () => {
    const data = Buffer.from([1, 2, 3]).toString('base64')
    const block = parseAccountBlockJson(send({ amount: '250', data }), BOUND_CHAIN_ID)

    expect(block.blockType).toBe(2)
    expect(block.toAddress.toString()).toBe(ADDRESS)
    expect(block.tokenStandard.toString()).toBe(ZNN)
    expect(block.amount).toBe(250n)
    expect(Buffer.from(block.data).toString('base64')).toBe(data)
  })

  it('builds a receive from its fromBlockHash alone', () => {
    const fromBlockHash = 'ab'.repeat(32)
    const minimal = parseAccountBlockJson({ blockType: 3, fromBlockHash }, BOUND_CHAIN_ID)
    const withExtras = parseAccountBlockJson(
      {
        blockType: 3,
        fromBlockHash,
        toAddress: OTHER_ADDRESS,
        tokenStandard: ZNN,
        amount: '5',
        ...DAPP_CHOSEN_FIELDS,
      },
      BOUND_CHAIN_ID
    )

    expect(withExtras.toJson()).toEqual(minimal.toJson())
    expect(withExtras.fromBlockHash.toString()).toBe(fromBlockHash)
    expect(withExtras.chainIdentifier).toBe(BOUND_CHAIN_ID)
  })

  it('throws InvalidParamsError for a block that fails validation', () => {
    expect(() => parseAccountBlockJson(send({ blockType: 4 }), BOUND_CHAIN_ID)).toThrow(
      InvalidParamsError
    )
  })
})

describe('parseSendTransactionParams', () => {
  it('builds a plain send with no data, on the bound chain, ignoring extra fields', () => {
    const params = { to: ADDRESS, tokenStandard: ZNN, amount: '7' }
    const minimal = parseSendTransactionParams(params, BOUND_CHAIN_ID)
    const withExtras = parseSendTransactionParams(
      { ...params, data: Buffer.from([9]).toString('base64'), ...DAPP_CHOSEN_FIELDS },
      BOUND_CHAIN_ID
    )

    expect(withExtras.toJson()).toEqual(minimal.toJson())
    expect(withExtras.chainIdentifier).toBe(BOUND_CHAIN_ID)
    expect(withExtras.data.length).toBe(0)
  })
})

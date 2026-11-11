import { describe, expect, it, vi } from 'vitest'
import type { AccountBlockTemplate, KeyPair, Zenon } from 'znn-typescript-sdk'

import { TransactionService } from '@/core/transaction-service'

const block = { blockType: 2 } as unknown as AccountBlockTemplate
const prepared = { blockType: 2, hash: 'prepared' } as unknown as AccountBlockTemplate
const keyPair = {} as KeyPair

function service() {
  const calls: string[] = []
  const zenon = {
    prepareBlock: vi.fn(async () => {
      calls.push('prepare')
      return prepared
    }),
    ledger: {
      publishRawTransaction: vi.fn(async (b: AccountBlockTemplate) => {
        calls.push('publish')
        return b
      }),
    },
  }
  const transactions = new TransactionService({
    getZenon: () => zenon as unknown as Zenon,
    ensureInitialized: async () => {},
  })
  return { transactions, zenon, calls }
}

describe('TransactionService.sendEmbeddedContractBlock', () => {
  it('runs beforePublish after PoW and signing, then publishes the prepared block', async () => {
    const { transactions, zenon, calls } = service()
    const beforePublish = vi.fn(() => calls.push('beforePublish'))

    const sent = await transactions.sendEmbeddedContractBlock(block, keyPair, beforePublish)

    expect(calls).toEqual(['prepare', 'beforePublish', 'publish'])
    expect(zenon.prepareBlock).toHaveBeenCalledWith(block, keyPair)
    expect(zenon.ledger.publishRawTransaction).toHaveBeenCalledWith(prepared)
    expect(sent).toBe(prepared)
  })

  it('does not publish when beforePublish throws', async () => {
    const { transactions, zenon } = service()
    const lapsed = new Error('lapsed')

    await expect(
      transactions.sendEmbeddedContractBlock(block, keyPair, () => {
        throw lapsed
      })
    ).rejects.toBe(lapsed)

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
  })

  it('publishes without a beforePublish check', async () => {
    const { transactions, calls } = service()

    await transactions.sendEmbeddedContractBlock(block, keyPair)

    expect(calls).toEqual(['prepare', 'publish'])
  })
})

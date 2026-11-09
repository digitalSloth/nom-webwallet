import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountBlockTemplate, Zenon } from 'znn-typescript-sdk'

import { SEND_TIMEOUT_MS } from '@/config'
import { isSendBusy } from './send-status'

vi.mock('@/core/zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))
vi.mock('znn-typescript-sdk', () => ({
  AccountBlockTemplate: {},
  Address: {},
  Hash: {},
  KeyPair: class {},
  TokenStandard: {},
}))

import { TransactionService } from './transaction-service'

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: Error) => void }
function deferred(): Deferred {
  let resolve!: (v: unknown) => void
  let reject!: (e: Error) => void
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const keyPair = {} as never
const blockA = { id: 'a' } as never
const blockB = { id: 'b' } as never

// publishRawTransaction echoes the prepared block, so each test's `send`
// mock (the PoW and signing stage) decides what the send resolves to.
function makeService(send: ReturnType<typeof vi.fn>) {
  const zenon = { prepareBlock: send, ledger: { publishRawTransaction: async (b: unknown) => b } }
  const fake = { getZenon: () => zenon, ensureInitialized: async () => {} }
  return new TransactionService(fake as never)
}

const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('TransactionService.sendEmbeddedContractBlock', () => {
  const block = { blockType: 2 } as unknown as AccountBlockTemplate
  const prepared = { blockType: 2, hash: 'prepared' } as unknown as AccountBlockTemplate

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

describe('TransactionService send queue', () => {
  it('starts the second send only after the first resolves', async () => {
    const first = deferred()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce('second')
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)

    first.resolve('first')
    await expect(p1).resolves.toBe('first')
    await expect(p2).resolves.toBe('second')
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('rejects the first caller on failure and still runs the second send', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('publish failed')).mockResolvedValueOnce('ok')
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    await expect(p1).rejects.toThrow('publish failed')
    await expect(p2).resolves.toBe('ok')
  })

  it('keeps isSendBusy true while the second send is queued and clears it after both settle', async () => {
    const first = deferred()
    const second = deferred()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    await flush()
    first.resolve('first')
    await p1
    expect(isSendBusy.value).toBe(true)

    second.resolve('second')
    await p2
    expect(isSendBusy.value).toBe(false)
  })

  it('abandons a hung send after SEND_TIMEOUT_MS, then runs the queued send and clears the lock', async () => {
    const send = vi.fn().mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce('second')
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const rejection = expect(p1).rejects.toThrow(/did not respond in time/)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(isSendBusy.value).toBe(true)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
    await expect(p2).resolves.toBe('second')
    expect(send).toHaveBeenCalledTimes(2)
    expect(isSendBusy.value).toBe(false)
  })

  it('starts the timeout when a send leaves the queue, not when it is enqueued', async () => {
    const first = deferred()
    const send = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}))
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    let p2Settled = false
    p2.then(
      () => (p2Settled = true),
      () => (p2Settled = true)
    )
    const rejection = expect(p2).rejects.toThrow(/did not respond in time/)

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1000)
    first.resolve('first')
    await p1
    await flush()
    expect(send).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1)
    expect(p2Settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await rejection
  })
})

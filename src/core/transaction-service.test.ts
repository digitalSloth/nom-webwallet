import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountBlockTemplate, Zenon } from 'znn-typescript-sdk'

import { SEND_ABANDONED_DEADLINE_MS, SEND_TIMEOUT_MS } from '@/config'
import { NODE_REFUSAL_MESSAGES } from './node-refusal-messages'
import { isSendBusy, sendContext, sendPhase } from './send-status'
import { getSendRecorder, setSendRecorder } from './send-recorder'
import type { SendContext, SendRecorder } from './send-recorder'

vi.mock('@/core/zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))
vi.mock('znn-typescript-sdk', () => ({
  AccountBlockTemplate: { receive: (hash: unknown) => ({ received: hash }) },
  Address: {},
  Hash: { parse: (value: string) => ({ parsed: value }) },
  KeyPair: class {},
  TokenStandard: {},
}))

import {
  isNodeRejection,
  PublishRejectedError,
  SEND_TIMEOUT_MESSAGE,
  SendSuspendedError,
  suspendPendingPublishes,
  TransactionService,
} from './transaction-service'

type Deferred = {
  promise: Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}
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

describe('TransactionService.receiveTransaction', () => {
  const prepared = { hash: 'prepared' } as unknown as AccountBlockTemplate

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

  it('runs beforePublish after prepare and before publish', async () => {
    const { transactions, zenon, calls } = service()
    const beforePublish = vi.fn(() => calls.push('beforePublish'))

    const sent = await transactions.receiveTransaction('hash1', keyPair, undefined, beforePublish)

    expect(calls).toEqual(['prepare', 'beforePublish', 'publish'])
    expect(zenon.prepareBlock).toHaveBeenCalledWith({ received: { parsed: 'hash1' } }, keyPair)
    expect(sent).toBe(prepared)
  })

  it('does not publish when beforePublish throws', async () => {
    const { transactions, zenon } = service()
    const stopped = new Error('stopped')

    await expect(
      transactions.receiveTransaction('hash1', keyPair, undefined, () => {
        throw stopped
      })
    ).rejects.toBe(stopped)

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
  })

  it('publishes without a beforePublish check', async () => {
    const { transactions, calls } = service()

    await transactions.receiveTransaction('hash1', keyPair)

    expect(calls).toEqual(['prepare', 'publish'])
  })

  it('makes a later send wait for a background receive that is generating PoW', async () => {
    const pow = deferred()
    const autoBlock = { hash: { toString: () => 'auto' } }
    const manualBlock = { hash: { toString: () => 'manual' } }
    const send = vi.fn().mockReturnValueOnce(pow.promise).mockResolvedValueOnce(manualBlock)
    const transactions = makeService(send)
    const background: SendContext = {
      kind: 'receive',
      title: 'Auto-receive 1 ZNN',
      from: 'z1from',
      background: true,
    }

    const auto = transactions.receiveTransaction('hash1', keyPair, background)
    const manual = transactions.sendEmbeddedContractBlock(blockB, keyPair)
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(isSendBusy.value).toBe(true)

    pow.resolve(autoBlock)
    await expect(auto).resolves.toBe(autoBlock)
    await expect(manual).resolves.toBe(manualBlock)
    expect(send).toHaveBeenCalledTimes(2)
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
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('publish failed'))
      .mockResolvedValueOnce('ok')
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
    const send = vi
      .fn()
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValueOnce('second')
    const service = makeService(send)

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const rejection = expect(p1).rejects.toThrow(/outcome is unknown.*may still go through/)
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
    const send = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(new Promise(() => {}))
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

describe('TransactionService send recording', () => {
  const ctx: SendContext = { kind: 'send', title: 'Send', from: 'z1from' }
  const noop: SendRecorder = getSendRecorder()
  const preparedOf = (hash: string) => ({ hash: { toString: () => hash } })
  let calls: string[]

  function fakeRecorder(): SendRecorder {
    return {
      begin: () => {
        calls.push('begin')
        return {
          publishing: (h) => {
            calls.push(`publishing:${h}`)
          },
          published: (h) => calls.push(`published:${h}`),
          abandon: () => calls.push('abandon'),
          detach: () => calls.push('detach'),
        }
      },
      release: async () => {},
    }
  }

  function build(
    prepare: (b: unknown) => Promise<unknown>,
    publish: (b: unknown) => Promise<unknown>
  ) {
    const zenon = {
      prepareBlock: vi.fn(prepare),
      ledger: { publishRawTransaction: vi.fn(publish) },
    }
    return new TransactionService({
      getZenon: () => zenon as never,
      ensureInitialized: async () => {},
    })
  }

  beforeEach(() => {
    calls = []
    setSendRecorder(fakeRecorder())
  })
  afterEach(() => {
    setSendRecorder(noop)
    sendPhase.value = null
  })

  it('records begin, publishing, published in order and resolves with the published block', async () => {
    const service = build(
      async () => preparedOf('h1'),
      async (b) => {
        calls.push('publish-call')
        return b
      }
    )

    await service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)

    expect(calls).toEqual(['begin', 'publishing:h1', 'publish-call', 'published:h1'])
  })

  it('begins the recording while an earlier send still holds the queue', async () => {
    const first = deferred()
    const service = build(
      async (b) => (b === blockA ? first.promise : preparedOf('h2')),
      async (b) => b
    )

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    await flush()
    expect(calls).toEqual(['begin'])
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair, undefined, ctx)
    await flush()

    expect(calls).toEqual(['begin', 'begin'])

    first.resolve(preparedOf('h1'))
    await p1
    await p2
  })

  it('abandons the recording when prepare fails', async () => {
    const service = build(
      async () => {
        throw new Error('pow failed')
      },
      async (b) => b
    )

    await expect(
      service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    ).rejects.toThrow('pow failed')

    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('detaches the recording and reports an unknown outcome when publish fails in time', async () => {
    const service = build(
      async () => preparedOf('h1'),
      async () => {
        throw new Error('rejected')
      }
    )

    await expect(
      service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    ).rejects.toThrow(SEND_TIMEOUT_MESSAGE)

    expect(calls).toEqual(['begin', 'publishing:h1', 'detach'])
  })

  it('keeps the recording on the timeout while the attempt is unsettled', async () => {
    const service = build(
      () => new Promise(() => {}),
      async (b) => b
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    expect(calls).toEqual(['begin'])
  })

  it('abandons the recording when a timed-out attempt fails before publishing', async () => {
    const latePrepare = deferred()
    const service = build(
      () => latePrepare.promise,
      async (b) => b
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection
    expect(calls).toEqual(['begin'])

    latePrepare.reject(new Error('pow failed'))
    await flush()

    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('abandons the recording when a timed-out attempt is stopped by beforePublish', async () => {
    const latePrepare = deferred()
    const service = build(
      () => latePrepare.promise,
      async (b) => b
    )
    const gate = vi.fn(() => {
      throw new Error('guard says no')
    })

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, gate, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    latePrepare.resolve(preparedOf('h1'))
    await flush()

    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('makes no recorder calls without a context', async () => {
    const service = build(
      async () => preparedOf('h1'),
      async (b) => b
    )

    await service.sendEmbeddedContractBlock(blockA, keyPair)

    expect(calls).toEqual([])
  })

  it('reports sendPhase as preparing, publishing, then null', async () => {
    const seen: unknown[] = []
    const service = build(
      async () => {
        seen.push(sendPhase.value)
        return preparedOf('h1')
      },
      async (b) => {
        seen.push(sendPhase.value)
        return b
      }
    )

    await service.sendEmbeddedContractBlock(blockA, keyPair)

    expect(seen).toEqual(['preparing', 'publishing'])
    expect(sendPhase.value).toBeNull()
  })

  it('clears sendPhase when a send fails', async () => {
    const service = build(
      async () => {
        throw new Error('nope')
      },
      async (b) => b
    )

    await expect(service.sendEmbeddedContractBlock(blockA, keyPair)).rejects.toThrow('nope')

    expect(sendPhase.value).toBeNull()
  })

  it('handles a publish that resolves after the timeout without touching sendPhase', async () => {
    const late = deferred()
    const service = build(
      async () => preparedOf('h1'),
      () => late.promise
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/outcome is unknown.*may still go through/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection
    expect(sendPhase.value).toBeNull()

    late.resolve(preparedOf('h1'))
    await flush()

    expect(sendPhase.value).toBeNull()
    expect(calls).toEqual(['begin', 'publishing:h1', 'published:h1', 'detach'])
  })

  it('keeps the queued send phase while a timed-out attempt finishes late', async () => {
    const stale = deferred()
    const live = deferred()
    let publishes = 0
    const service = build(
      async (b) => preparedOf(b === blockA ? 'h1' : 'h2'),
      () => (++publishes === 1 ? stale.promise : live.promise)
    )

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair)
    const rejection = expect(p1).rejects.toThrow(/did not respond in time/)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection
    await flush()
    expect(sendPhase.value).toBe('publishing')

    stale.resolve(preparedOf('h1'))
    await flush()
    expect(sendPhase.value).toBe('publishing')

    live.resolve('second')
    await expect(p2).resolves.toBe('second')
    expect(sendPhase.value).toBeNull()
  })

  it('records publishing before the publish call when a timed-out attempt publishes', async () => {
    const latePrepare = deferred()
    const service = build(
      () => latePrepare.promise,
      async (b) => {
        calls.push('publish-call')
        return b
      }
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    latePrepare.resolve(preparedOf('h1'))
    await flush()

    expect(sendPhase.value).toBeNull()
    expect(calls).toEqual(['begin', 'publishing:h1', 'publish-call', 'published:h1', 'detach'])
  })

  it('detaches a record stuck mid-publish at the deadline and keeps it', async () => {
    const hung = deferred()
    const service = build(
      async () => preparedOf('h1'),
      () => hung.promise
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection
    expect(calls).toEqual(['begin', 'publishing:h1'])

    await vi.advanceTimersByTimeAsync(SEND_ABANDONED_DEADLINE_MS)
    expect(calls).toEqual(['begin', 'publishing:h1', 'detach'])

    hung.resolve(preparedOf('h1'))
    await flush()
    expect(calls).toEqual(['begin', 'publishing:h1', 'detach', 'published:h1', 'detach'])
  })

  it('detaches, never removes, a timed-out attempt whose publish later fails with a transport error', async () => {
    const hung = deferred()
    const service = build(
      async () => preparedOf('h1'),
      () => hung.promise
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    hung.reject(new Error('socket closed'))
    await flush()
    expect(calls).toEqual(['begin', 'publishing:h1', 'detach'])
  })

  it('removes the record of a timed-out attempt whose publish the node refuses', async () => {
    const hung = deferred()
    const service = build(
      async () => preparedOf('h1'),
      () => hung.promise
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    hung.reject(Object.assign(new Error('account-block version is invalid'), { code: -32000 }))
    await flush()
    expect(calls).toEqual(['begin', 'publishing:h1', 'abandon'])
  })

  it('cancels and abandons an attempt still preparing at the deadline', async () => {
    const latePrepare = deferred()
    const publish = vi.fn(async (b: unknown) => b)
    const service = build(() => latePrepare.promise, publish)

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection

    await vi.advanceTimersByTimeAsync(SEND_ABANDONED_DEADLINE_MS)
    expect(calls).toEqual(['begin', 'abandon'])

    latePrepare.resolve(preparedOf('h1'))
    await flush()
    expect(publish).not.toHaveBeenCalled()
    expect(calls).not.toContain('publishing:h1')
  })

  it('does not detach or abandon at the deadline once the attempt settled', async () => {
    const latePrepare = deferred()
    const service = build(
      () => latePrepare.promise,
      async (b) => b
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(p).rejects.toThrow(/did not respond in time/)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await rejection
    latePrepare.resolve(preparedOf('h1'))
    await flush()
    const before = [...calls]

    await vi.advanceTimersByTimeAsync(SEND_ABANDONED_DEADLINE_MS)

    expect(calls).toEqual(before)
  })
})

describe('TransactionService node rejection', () => {
  const ctx: SendContext = {
    kind: 'send',
    title: 'Send',
    from: 'z1from',
    progress: 'Sending 1 ZNN',
  }
  const noop: SendRecorder = getSendRecorder()
  const preparedOf = (hash: string) => ({ hash: { toString: () => hash } })
  let calls: string[]

  function build(
    prepare: (b: unknown) => Promise<unknown>,
    publish: (b: unknown) => Promise<unknown>
  ) {
    const zenon = {
      prepareBlock: vi.fn(prepare),
      ledger: { publishRawTransaction: vi.fn(publish) },
    }
    return new TransactionService({
      getZenon: () => zenon as never,
      ensureInitialized: async () => {},
    })
  }

  const publishing = (err: unknown) =>
    build(
      async () => preparedOf('h1'),
      async () => {
        throw err
      }
    )

  beforeEach(() => {
    calls = []
    setSendRecorder({
      begin: () => ({
        publishing: (h) => {
          calls.push(`publishing:${h}`)
        },
        published: (h) => calls.push(`published:${h}`),
        abandon: () => calls.push('abandon'),
        detach: () => calls.push('detach'),
      }),
      release: async () => {},
    })
  })
  afterEach(() => {
    setSendRecorder(noop)
    sendPhase.value = null
    sendContext.value = null
  })

  it('turns a -32000 refusal into PublishRejectedError carrying the node message', async () => {
    const service = publishing({ code: -32000, message: 'insufficient balance for transfer' })

    const err = await service
      .sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
      .catch((e) => e)

    expect(err).toBeInstanceOf(PublishRejectedError)
    expect(err.reason).toBe('insufficient balance for transfer')
    expect(err.message).toBe('insufficient balance for transfer')
    expect(calls).toEqual(['publishing:h1', 'abandon'])
    expect(sendPhase.value).toBeNull()
    expect(sendContext.value).toBeNull()
  })

  it.each([-32600, -32601, -32602, -32700])('treats code %i as a rejection', async (code) => {
    const service = publishing({ code, message: 'refused' })

    await expect(service.sendEmbeddedContractBlock(blockA, keyPair)).rejects.toBeInstanceOf(
      PublishRejectedError
    )
  })

  it('falls back to a fixed reason when the node gives no message', async () => {
    const service = publishing({ code: -32600 })

    const err = await service.sendEmbeddedContractBlock(blockA, keyPair).catch((e) => e)

    expect(err).toBeInstanceOf(PublishRejectedError)
    expect(err.reason).toBe('no reason given')
  })

  const unconfirmed: [string, unknown][] = [
    ['-1', { code: -1, message: 'x' }],
    ['7777', { code: 7777, message: 'x' }],
    ['7979', { code: 7979, message: 'x' }],
    ['11', { code: 11, message: 'x' }],
    ['-32603 internal error', { code: -32603, message: 'internal error' }],
    ['-32002 handler timeout', { code: -32002, message: 'timeout' }],
    ['-32000 handler crash', { code: -32000, message: 'method handler crashed' }],
    ['-32000 unknown text', { code: -32000, message: 'something unexpected' }],
    ['-32000 proxy timeout', { code: -32000, message: 'upstream request timeout' }],
    ['-32000 no message', { code: -32000 }],
    ['a string code', { code: '-32000', message: 'x' }],
    ['no code', new Error('socket closed')],
    ['a null error', null],
    ['a string error', 'boom'],
  ]

  it.each(unconfirmed)('reports an unknown outcome and detaches for %s', async (_name, thrown) => {
    const service = publishing(thrown)

    const caught = await service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx).then(
      () => 'resolved',
      (e) => e
    )

    expect(caught).not.toBeInstanceOf(PublishRejectedError)
    expect(caught.message).toBe(SEND_TIMEOUT_MESSAGE)
    expect(caught.cause).toBe(thrown)
    expect(calls).toEqual(['publishing:h1', 'detach'])
  })

  it('isNodeRejection accepts only allow-listed numeric codes', () => {
    expect(isNodeRejection({ code: -32000 })).toBe(false)
    expect(isNodeRejection({ code: -32000, message: 'upstream request timeout' })).toBe(false)
    expect(isNodeRejection({ code: -32000, message: 'insufficient balance for transfer' })).toBe(
      true
    )
    expect(isNodeRejection({ code: -32000, message: 'method handler crashed' })).toBe(false)
    expect(isNodeRejection({ code: -32603 })).toBe(false)
    expect(isNodeRejection({ code: -32002 })).toBe(false)
    expect(isNodeRejection({ code: '-32000' })).toBe(false)
    expect(isNodeRejection({})).toBe(false)
    expect(isNodeRejection(null)).toBe(false)
    expect(isNodeRejection(undefined)).toBe(false)
    expect(isNodeRejection('-32000')).toBe(false)
  })

  it('rethrows a -32000 from prepareBlock unchanged', async () => {
    const thrown = { code: -32000, message: 'pow failed' }
    const service = build(
      async () => {
        throw thrown
      },
      async (b) => b
    )

    const caught = await service.sendEmbeddedContractBlock(blockA, keyPair).catch((e) => e)

    expect(caught).toBe(thrown)
  })

  it('does not read a late rejection as a refusal: the timeout message surfaces', async () => {
    const late = deferred()
    const service = build(
      async () => preparedOf('h1'),
      () => late.promise
    )

    const p = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const caught = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    const err = await caught
    expect(err).not.toBeInstanceOf(PublishRejectedError)
    expect(err.message).toBe(SEND_TIMEOUT_MESSAGE)

    late.reject({ code: -32000, message: 'late' } as never)
    await flush()
    expect(sendContext.value).toBeNull()
  })

  it('exposes the send context while the attempt runs and clears it after', async () => {
    const seen: unknown[] = []
    const service = build(
      async () => {
        seen.push(sendContext.value)
        return preparedOf('h1')
      },
      async (b) => {
        seen.push(sendContext.value)
        return b
      }
    )

    await service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)

    expect(seen).toEqual([ctx, ctx])
    expect(sendContext.value).toBeNull()
  })

  it('leaves sendContext null when no context is passed', async () => {
    const seen: unknown[] = []
    const service = build(
      async () => {
        seen.push(sendContext.value)
        return preparedOf('h1')
      },
      async (b) => b
    )

    await service.sendEmbeddedContractBlock(blockA, keyPair)

    expect(seen).toEqual([null])
  })
})

describe('NODE_REFUSAL_MESSAGES', () => {
  it.each(NODE_REFUSAL_MESSAGES)('classifies the go-zenon message %j as a rejection', (message) => {
    expect(isNodeRejection({ code: -32000, message })).toBe(true)
  })

  it('accepts a wrapped verifier message and the formatted chain mismatch message', () => {
    expect(
      isNodeRejection({
        code: -32000,
        message: 'internal error while verifying - db closed',
      })
    ).toBe(true)
    expect(
      isNodeRejection({
        code: -32000,
        message: 'the block has a different network Id (3) from the node (1)',
      })
    ).toBe(true)
  })

  it.each([
    'gateway: the block has a different network Id (3) from the node (1)',
    'the block has a different network',
    'gateway: internal error while verifying - db closed',
    'insufficient balance for transfer foo',
    'insufficient balance for transfer -detail',
    'INSUFFICIENT BALANCE FOR TRANSFER',
    ' insufficient balance for transfer',
    '',
  ])('does not treat %j as a refusal', (message) => {
    expect(isNodeRejection({ code: -32000, message })).toBe(false)
  })

  it('does not treat a non-string message as a refusal and does not throw', () => {
    expect(isNodeRejection({ code: -32000, message: 5 })).toBe(false)
    expect(isNodeRejection({ code: -32000, message: null })).toBe(false)
    expect(isNodeRejection({ code: -32000, message: ['insufficient balance for transfer'] })).toBe(
      false
    )
  })

  it.each([-32600, -32601, -32602, -32700])(
    'keeps code %i a rejection whatever the message',
    (code) => {
      expect(isNodeRejection({ code, message: 'anything at all' })).toBe(true)
      expect(isNodeRejection({ code })).toBe(true)
    }
  )

  it.each([-32603, -32002, -1])('keeps code %i out even with a known message', (code) => {
    expect(isNodeRejection({ code, message: 'insufficient balance for transfer' })).toBe(false)
  })

  it.each([
    'supervisor - VM panic',
    'insufficient balance for transfer',
    'not enough plasma on account',
    'account-block signature is invalid',
    'account-block chain-identifier mismatch (belongs to another chain)',
    'invalid arguments',
  ])('keeps %j in the list', (message) => {
    expect(NODE_REFUSAL_MESSAGES).toContain(message)
  })

  it('rejects a message that only contains a known one', () => {
    expect(
      isNodeRejection({ code: -32000, message: 'gateway: insufficient balance for transfer' })
    ).toBe(false)
  })
})

describe('TransactionService publish ordering and suspension', () => {
  const ctx: SendContext = { kind: 'send', title: 'Send', from: 'z1from' }
  const noop: SendRecorder = getSendRecorder()
  const preparedOf = (hash: string) => ({ hash: { toString: () => hash } })
  let calls: string[]
  let publishing: (hash: string) => void | Promise<void>

  beforeEach(() => {
    calls = []
    publishing = (h) => {
      calls.push(`publishing:${h}`)
    }
    setSendRecorder({
      begin: () => {
        calls.push('begin')
        return {
          publishing: (h) => publishing(h),
          published: (h) => calls.push(`published:${h}`),
          abandon: () => calls.push('abandon'),
          detach: () => calls.push('detach'),
        }
      },
      release: async () => {},
    })
  })
  afterEach(() => {
    setSendRecorder(noop)
    sendPhase.value = null
  })

  function build(prepare: (b: unknown) => Promise<unknown>) {
    const zenon = {
      prepareBlock: vi.fn(prepare),
      ledger: {
        publishRawTransaction: vi.fn(async (b: unknown) => {
          calls.push('publish-call')
          return b
        }),
      },
    }
    const service = new TransactionService({
      getZenon: () => zenon as never,
      ensureInitialized: async () => {},
    })
    return { service, zenon }
  }

  it('does not call publishRawTransaction until a pending publishing promise resolves', async () => {
    const commit = deferred()
    publishing = () => commit.promise as Promise<void>
    const { service, zenon } = build(async () => preparedOf('h1'))

    const sent = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    await flush()
    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
    expect(sendPhase.value).toBe('preparing')

    commit.resolve(undefined)
    await sent

    expect(zenon.ledger.publishRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('stops, abandons and rethrows when publishing rejects, never contacting the node', async () => {
    const failure = new Error('could not save')
    publishing = () => Promise.reject(failure)
    const { service, zenon } = build(async () => preparedOf('h1'))

    await expect(service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)).rejects.toBe(
      failure
    )

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('throws SendSuspendedError when suspended during prepareBlock and publishes nothing', async () => {
    const prepare = deferred()
    const { service, zenon } = build(() => prepare.promise)

    const sent = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(sent).rejects.toBeInstanceOf(SendSuspendedError)
    await flush()
    suspendPendingPublishes()
    prepare.resolve(preparedOf('h1'))
    await rejection

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
    expect(calls).toEqual(['begin', 'abandon'])
  })

  it('throws SendSuspendedError when suspended while publishing is pending', async () => {
    const commit = deferred()
    publishing = (h) => {
      calls.push(`publishing:${h}`)
      return commit.promise as Promise<void>
    }
    const { service, zenon } = build(async () => preparedOf('h1'))

    const sent = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const rejection = expect(sent).rejects.toBeInstanceOf(SendSuspendedError)
    await flush()
    suspendPendingPublishes()
    commit.resolve(undefined)
    await rejection

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
    expect(calls).toEqual(['begin', 'publishing:h1', 'abandon'])
  })

  it('never publishes a send queued behind another when suspension runs', async () => {
    const first = deferred()
    const { service, zenon } = build(async (b) => (b === blockA ? first.promise : preparedOf('h2')))

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair, undefined, ctx)
    const r1 = expect(p1).rejects.toBeInstanceOf(SendSuspendedError)
    const r2 = expect(p2).rejects.toBeInstanceOf(SendSuspendedError)
    await flush()
    suspendPendingPublishes()
    first.resolve(preparedOf('h1'))
    await r1
    await r2

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
    expect(calls.filter((c) => c === 'abandon')).toHaveLength(2)
  })

  it('stops a send queued before the suspension even though it leaves the queue after it', async () => {
    const first = deferred()
    const { service, zenon } = build(async (b) => (b === blockA ? first.promise : preparedOf('h2')))

    const p1 = service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)
    await flush()
    const p2 = service.sendEmbeddedContractBlock(blockB, keyPair, undefined, ctx)
    const r2 = expect(p2).rejects.toBeInstanceOf(SendSuspendedError)
    await flush()
    suspendPendingPublishes()
    first.resolve(undefined)
    await p1.catch(() => {})
    await r2

    expect(zenon.ledger.publishRawTransaction).not.toHaveBeenCalled()
  })

  it('publishes a send that starts after the suspension', async () => {
    suspendPendingPublishes()
    const { service, zenon } = build(async () => preparedOf('h1'))

    await service.sendEmbeddedContractBlock(blockA, keyPair, undefined, ctx)

    expect(zenon.ledger.publishRawTransaction).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['begin', 'publishing:h1', 'publish-call', 'published:h1'])
  })
})

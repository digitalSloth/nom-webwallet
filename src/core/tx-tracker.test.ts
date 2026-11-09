import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STORAGE_KEY_TRACKED_TRANSACTIONS as KEY,
  TX_TRACK_POLL_MS,
  TX_TRACK_TIMEOUT_MS,
} from '@/config'
import {
  createTxTracker,
  describeStage,
  isFinal,
  readStage,
  type GetBlock,
  type TrackedBlock,
  type TrackedTx,
  type TxStage,
} from './tx-tracker'

const USER_SEND = 2
const CONTRACT_SEND = 4
const CONTRACT_RECEIVE = 5
const SUCCESS = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])
const FAILURE = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 2])

function block(over: Partial<TrackedBlock> = {}): TrackedBlock {
  return {
    blockType: CONTRACT_SEND,
    toAddress: { core: new Uint8Array([1]) },
    data: new Uint8Array(),
    confirmationDetail: { momentumHeight: 1234 },
    descendantBlocks: [],
    ...over,
  }
}

const hashOf = (h: string) => ({ hash: { toString: () => h } })
const blocksOf = (map: Record<string, TrackedBlock | null>): GetBlock => async (h) => map[h] ?? null

describe('readStage', () => {
  it('is published for a missing block', async () => {
    expect(await readStage('h', blocksOf({}))).toEqual({ kind: 'published' })
  })

  it('is published for an unconfirmed block', async () => {
    const getBlock = blocksOf({ h: block({ confirmationDetail: undefined }) })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'published' })
  })

  it('is received for a confirmed receive block', async () => {
    const getBlock = blocksOf({ h: block({ blockType: 3 }) })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'received', momentum: 1234 })
  })

  it.each([0, 2])('awaits the recipient for a send to core byte %i', async (byte) => {
    const getBlock = blocksOf({
      h: block({ blockType: USER_SEND, toAddress: { core: new Uint8Array([byte]) } }),
    })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'awaitingRecipient', momentum: 1234 })
  })

  it('is confirmed for a contract send with no paired block', async () => {
    expect(await readStage('h', blocksOf({ h: block() }))).toEqual({
      kind: 'confirmed',
      momentum: 1234,
    })
  })

  it('is failed when the paired receive carries status 2', async () => {
    const paired = block({ blockType: CONTRACT_RECEIVE, data: FAILURE })
    const getBlock = blocksOf({ h: block({ pairedAccountBlock: paired }) })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'failed', momentum: 1234 })
  })

  it('is executed with no follow-ons when the paired receive carries status 1', async () => {
    const paired = block({ blockType: CONTRACT_RECEIVE, data: SUCCESS })
    const getBlock = blocksOf({ h: block({ pairedAccountBlock: paired }) })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'executed', pendingFollowOns: 0 })
  })

  it('does not treat a non-8-byte payload ending in 2 as failure', async () => {
    const paired = block({ blockType: CONTRACT_RECEIVE, data: new Uint8Array([0, 2]) })
    const getBlock = blocksOf({ h: block({ pairedAccountBlock: paired }) })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'executed', pendingFollowOns: 0 })
  })

  it('counts follow-ons that are missing or unconfirmed as pending', async () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: SUCCESS,
      descendantBlocks: [hashOf('d1'), hashOf('d2'), hashOf('d3')],
    })
    const getBlock = blocksOf({
      h: block({ pairedAccountBlock: paired }),
      d1: block({ blockType: 3 }),
      d2: block({ blockType: 3, confirmationDetail: undefined }),
      d3: null,
    })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'executed', pendingFollowOns: 2 })
  })

  it('settles a nested follow-on only once its own pair and descendants settle', async () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: SUCCESS,
      descendantBlocks: [hashOf('d1')],
    })
    const nestedPair = (descendants: string[]) =>
      block({
        blockType: CONTRACT_RECEIVE,
        data: SUCCESS,
        descendantBlocks: descendants.map(hashOf),
      })
    const root = block({ pairedAccountBlock: paired })
    const pending = blocksOf({
      h: root,
      d1: block({ pairedAccountBlock: nestedPair(['d2']) }),
      d2: block({ blockType: 3, confirmationDetail: undefined }),
    })
    expect(await readStage('h', pending)).toEqual({ kind: 'executed', pendingFollowOns: 1 })

    const done = blocksOf({
      h: root,
      d1: block({ pairedAccountBlock: nestedPair(['d2']) }),
      d2: block({ blockType: 3 }),
    })
    expect(await readStage('h', done)).toEqual({ kind: 'executed', pendingFollowOns: 0 })
  })

  it('treats a nested follow-on contract send with no pair as pending', async () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: SUCCESS,
      descendantBlocks: [hashOf('d1')],
    })
    const getBlock = blocksOf({ h: block({ pairedAccountBlock: paired }), d1: block() })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'executed', pendingFollowOns: 1 })
  })

  it('treats a nested follow-on whose call failed as settled', async () => {
    const paired = block({
      blockType: CONTRACT_RECEIVE,
      data: SUCCESS,
      descendantBlocks: [hashOf('d1')],
    })
    const failedPair = block({ blockType: CONTRACT_RECEIVE, data: FAILURE })
    const getBlock = blocksOf({
      h: block({ pairedAccountBlock: paired }),
      d1: block({ pairedAccountBlock: failedPair }),
    })
    expect(await readStage('h', getBlock)).toEqual({ kind: 'executed', pendingFollowOns: 0 })
  })
})

describe('isFinal', () => {
  const cases: [TxStage, boolean][] = [
    [{ kind: 'published' }, false],
    [{ kind: 'confirmed', momentum: 1 }, false],
    [{ kind: 'awaitingRecipient', momentum: 1 }, true],
    [{ kind: 'received', momentum: 1 }, true],
    [{ kind: 'executed', pendingFollowOns: 0 }, true],
    [{ kind: 'executed', pendingFollowOns: 1 }, false],
    [{ kind: 'failed', momentum: 1 }, true],
    [{ kind: 'timedOut' }, true],
  ]
  it.each(cases)('%j is final: %s', (stage, expected) => {
    expect(isFinal(stage)).toBe(expected)
  })
})

describe('describeStage', () => {
  const cases: [TxStage, string, string][] = [
    [{ kind: 'published' }, 'Send: published, waiting for the network', 'loading'],
    [
      { kind: 'confirmed', momentum: 1234567 },
      'Send: confirmed in momentum 1,234,567, waiting for the contract',
      'loading',
    ],
    [
      { kind: 'awaitingRecipient', momentum: 12 },
      'Send: confirmed in momentum 12, waiting for the recipient',
      'success',
    ],
    [{ kind: 'received', momentum: 12 }, 'Send: confirmed in momentum 12', 'success'],
    [{ kind: 'executed', pendingFollowOns: 0 }, 'Send: executed', 'success'],
    [
      { kind: 'executed', pendingFollowOns: 1 },
      'Send: executed, waiting for 1 follow-on block',
      'loading',
    ],
    [
      { kind: 'executed', pendingFollowOns: 2 },
      'Send: executed, waiting for 2 follow-on blocks',
      'loading',
    ],
    [
      { kind: 'failed', momentum: 12 },
      'Send: confirmed in momentum 12, but the contract call failed',
      'error',
    ],
    [{ kind: 'timedOut' }, 'Send: Still waiting. Check the explorer.', 'warning'],
  ]
  it.each(cases)('%j', (stage, text, tone) => {
    expect(describeStage('Send', stage)).toEqual({ text, tone })
  })
})

describe('createTxTracker', () => {
  const NOW = 1_700_000_000_000
  const store = new Map<string, unknown>()
  const storage = {
    get: async <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
    set: async <T>(key: string, value: T) => void store.set(key, value),
  }
  const stored = () => (store.get(KEY) ?? []) as TrackedTx[]
  const tx = (hash: string, publishedAt = NOW): TrackedTx => ({
    hash,
    label: 'Send',
    address: 'z1addr',
    publishedAt,
  })
  const confirmedRecv = block({ blockType: 3 })
  const settle = () => vi.advanceTimersByTimeAsync(TX_TRACK_POLL_MS)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    store.clear()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('notifies published, then each changed stage once, stops at a final stage and drops the entry', async () => {
    let current: TrackedBlock | null = null
    const getBlock = vi.fn(async () => current)
    const notify = vi.fn()
    createTxTracker({ getBlock, notify, storage }).track(tx('h'))
    await vi.advanceTimersByTimeAsync(0)
    expect(stored()).toHaveLength(1)

    await settle()
    await settle()
    current = confirmedRecv
    await settle()
    const calls = getBlock.mock.calls.length
    await vi.advanceTimersByTimeAsync(TX_TRACK_POLL_MS * 3)

    expect(notify.mock.calls.map((c) => c[1])).toEqual([
      { kind: 'published' },
      { kind: 'received', momentum: 1234 },
    ])
    expect(getBlock.mock.calls.length).toBe(calls)
    expect(stored()).toEqual([])
  })

  it('does not notify or stop when getBlock throws, and recovers on the next poll', async () => {
    const getBlock = vi
      .fn<GetBlock>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(confirmedRecv)
    const notify = vi.fn()
    createTxTracker({ getBlock, notify, storage }).track(tx('h'))

    await settle()
    expect(notify).toHaveBeenCalledTimes(1)
    await settle()
    expect(notify).toHaveBeenLastCalledWith(expect.anything(), { kind: 'received', momentum: 1234 })
  })

  it('notifies timedOut at the deadline and removes the entry', async () => {
    const notify = vi.fn()
    createTxTracker({ getBlock: async () => null, notify, storage }).track(tx('h'))
    await vi.advanceTimersByTimeAsync(TX_TRACK_TIMEOUT_MS + TX_TRACK_POLL_MS)

    expect(notify).toHaveBeenLastCalledWith(expect.anything(), { kind: 'timedOut' })
    expect(notify.mock.calls.filter((c) => c[1].kind === 'timedOut')).toHaveLength(1)
    expect(stored()).toEqual([])
  })

  it('reaches timedOut when getBlock never resolves', async () => {
    const notify = vi.fn()
    const getBlock = vi.fn(() => new Promise<TrackedBlock | null>(() => {}))
    createTxTracker({ getBlock, notify, storage }).track(tx('h'))
    await vi.advanceTimersByTimeAsync(TX_TRACK_TIMEOUT_MS + TX_TRACK_POLL_MS * 3)

    expect(notify).toHaveBeenLastCalledWith(expect.anything(), { kind: 'timedOut' })
    expect(stored()).toEqual([])
  })

  it('survives a throwing notify callback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notify = vi.fn(() => {
      throw new Error('toast broke')
    })
    createTxTracker({ getBlock: async () => confirmedRecv, notify, storage }).track(tx('h'))
    await settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(notify).toHaveBeenCalledTimes(2)
    expect(stored()).toEqual([])
  })

  it('keeps tracking when storage fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      get: async () => {
        throw new Error('storage down')
      },
      set: async () => {
        throw new Error('storage down')
      },
    }
    const notify = vi.fn()
    createTxTracker({ getBlock: async () => confirmedRecv, notify, storage: broken }).track(tx('h'))
    await settle()
    expect(notify).toHaveBeenLastCalledWith(expect.anything(), { kind: 'received', momentum: 1234 })
  })

  it('stores a tracked entry and ignores a repeated hash', async () => {
    const getBlock = vi.fn(async () => null)
    const notify = vi.fn()
    const tracker = createTxTracker({ getBlock, notify, storage })
    tracker.track(tx('h'))
    tracker.track(tx('h'))
    await vi.advanceTimersByTimeAsync(0)

    expect(stored()).toEqual([tx('h')])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('resume drops expired and malformed entries silently and follows the rest', async () => {
    const live = tx('live', NOW - 1000)
    store.set(KEY, [
      live,
      tx('old', NOW - TX_TRACK_TIMEOUT_MS),
      { hash: 'bad' },
      { ...tx('nan'), publishedAt: Number.NaN },
      'junk',
    ])
    const notify = vi.fn()
    const tracker = createTxTracker({ getBlock: async () => null, notify, storage })
    await tracker.resume()

    expect(stored()).toEqual([live])
    expect(notify.mock.calls.map((c) => c[0].hash)).toEqual(['live'])
    expect(notify).toHaveBeenCalledWith(live, { kind: 'published' })
  })

  it('resume treats a non-array stored value as empty', async () => {
    store.set(KEY, { not: 'a list' })
    const notify = vi.fn()
    await createTxTracker({ getBlock: async () => null, notify, storage }).resume()
    expect(notify).not.toHaveBeenCalled()
  })

  it('resume skips hashes it already follows', async () => {
    const entry = tx('h', NOW - 1000)
    const notify = vi.fn()
    const tracker = createTxTracker({ getBlock: async () => null, notify, storage })
    tracker.track(entry)
    await tracker.resume()
    await tracker.resume()
    expect(notify).toHaveBeenCalledTimes(1)
  })
})

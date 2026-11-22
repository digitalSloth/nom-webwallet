import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_TRACKED_TRANSACTIONS as KEY, TX_TRACK_POLL_MS, TX_TRACK_TIMEOUT_MS } from '@/config'
import type { SendRecorder } from '../send-recorder'
import type { TrackedBlock } from '../tx-tracker'

const mocks = vi.hoisted(() => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
  getAccountBlock: vi.fn(),
  store: new Map<string, unknown>(),
  gate: { current: null as Promise<void> | null },
}))

vi.mock('nom-ui', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('../transaction-service', () => ({
  TransactionService: { getInstance: () => ({ getAccountBlock: mocks.getAccountBlock }) },
}))
vi.mock('../storage/storage-service', () => ({
  storageService: {
    get: async (key: string) => (mocks.store.has(key) ? mocks.store.get(key) : null),
    set: async (key: string, value: unknown) => {
      if (mocks.gate.current) await mocks.gate.current
      mocks.store.set(key, value)
    },
  },
}))

const NOW = 1_700_000_000_000
const USER_SEND = 2
const CONTRACT_SEND = 4
const CONTRACT_RECEIVE = 5

const userSend = (over: Partial<TrackedBlock> = {}): TrackedBlock => ({
  blockType: USER_SEND,
  toAddress: { core: new Uint8Array([0]) },
  data: new Uint8Array(),
  confirmationDetail: { momentumHeight: 77 },
  descendantBlocks: [],
  ...over,
})
const contractSend = (over: Partial<TrackedBlock> = {}): TrackedBlock =>
  userSend({ blockType: CONTRACT_SEND, toAddress: { core: new Uint8Array([1]) }, ...over })

let tracker: typeof import('./useTxTracker')
let recorder: typeof import('../send-recorder')
let release: ReturnType<typeof vi.fn>

const tx = (over: Record<string, unknown> = {}) => ({
  hash: 'h1',
  label: 'Send',
  address: 'z1addr',
  publishedAt: NOW,
  ...over,
})
const poll = (polls = 1) => vi.advanceTimersByTimeAsync(TX_TRACK_POLL_MS * polls)

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.store.clear()
  mocks.gate.current = null
  mocks.getAccountBlock.mockReset().mockResolvedValue(null)
  Object.values(mocks.toast).forEach((fn) => fn.mockReset())
  tracker = await import('./useTxTracker')
  recorder = await import('../send-recorder')
  release = vi.fn(async () => {})
  recorder.setSendRecorder({ begin: vi.fn(), release } as unknown as SendRecorder)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('tracked transaction store', () => {
  it('adds an entry at published and updates it per stage', async () => {
    const { get } = tracker.useTrackedTransactions()
    await tracker.trackPublished(tx())
    expect(get('h1')).toMatchObject({ stage: { kind: 'published' }, done: false })

    mocks.getAccountBlock.mockResolvedValue(contractSend())
    await poll()
    expect(get('h1')).toMatchObject({ stage: { kind: 'confirmed', momentum: 77 }, done: false })

    mocks.getAccountBlock.mockResolvedValue(
      contractSend({
        pairedAccountBlock: userSend({
          blockType: CONTRACT_RECEIVE,
          data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]),
        }),
      })
    )
    await poll()
    expect(get('h1')).toMatchObject({ stage: { kind: 'executed', pendingFollowOns: 0 }, done: true })
  })

  it('returns null for an unknown hash and sorts entries newest publish first', async () => {
    const { get, entries } = tracker.useTrackedTransactions()
    await tracker.trackPublished(tx({ hash: 'old', publishedAt: NOW - 1000 }))
    await tracker.trackPublished(tx({ hash: 'new', publishedAt: NOW }))

    expect(get('missing')).toBeNull()
    expect(entries.value.map((e) => e.tx.hash)).toEqual(['new', 'old'])
  })

  it('marks done with the stage kept when a followRecipient window ends on awaitingRecipient', async () => {
    tracker.configureTxTracker({ toasts: false, followRecipient: true })
    mocks.getAccountBlock.mockResolvedValue(userSend())
    await tracker.trackPublished(tx())

    await vi.advanceTimersByTimeAsync(TX_TRACK_TIMEOUT_MS + TX_TRACK_POLL_MS)

    expect(tracker.useTrackedTransactions().get('h1')).toMatchObject({
      stage: { kind: 'awaitingRecipient', momentum: 77 },
      done: true,
    })
  })

  it('follows a user send to received when followRecipient is on', async () => {
    tracker.configureTxTracker({ toasts: false, followRecipient: true })
    mocks.getAccountBlock.mockResolvedValue(userSend())
    await tracker.trackPublished(tx())
    await poll(2)
    expect(tracker.useTrackedTransactions().get('h1')?.done).toBe(false)

    mocks.getAccountBlock.mockResolvedValue(
      userSend({ pairedAccountBlock: userSend({ blockType: 3 }) })
    )
    await poll()

    expect(tracker.useTrackedTransactions().get('h1')).toMatchObject({
      stage: { kind: 'received', momentum: 77 },
      done: true,
    })
  })
})

describe('toasts', () => {
  it('shows a loading toast by default (the web keeps tracker toasts)', async () => {
    await tracker.trackPublished(tx())

    expect(mocks.toast.loading).toHaveBeenCalledWith(
      'Send: published, waiting for the network',
      expect.objectContaining({ id: 'tx-h1' })
    )
  })

  it('shows a success toast with a new id at a final stage by default', async () => {
    mocks.getAccountBlock.mockResolvedValue(userSend({ blockType: 3 }))
    await tracker.trackPublished(tx())
    await poll()

    expect(mocks.toast.dismiss).toHaveBeenCalledWith('tx-h1')
    expect(mocks.toast.success).toHaveBeenCalledWith(
      expect.stringContaining('confirmed in momentum 77'),
      expect.objectContaining({ id: 'tx-h1-done' })
    )
  })

  it('shows no toast when toasts are off', async () => {
    tracker.configureTxTracker({ toasts: false, followRecipient: false })
    mocks.getAccountBlock.mockResolvedValue(userSend({ blockType: 3 }))

    await tracker.trackPublished(tx())
    await poll()

    for (const fn of Object.values(mocks.toast)) expect(fn).not.toHaveBeenCalled()
    expect(tracker.useTrackedTransactions().get('h1')?.done).toBe(true)
  })
})

describe('trackPublished', () => {
  it('releases the send record only after the storage add has resolved', async () => {
    let open!: () => void
    mocks.gate.current = new Promise<void>((resolve) => (open = resolve))

    const done = tracker.trackPublished(tx())
    await vi.advanceTimersByTimeAsync(10)
    expect(release).not.toHaveBeenCalled()
    expect(mocks.store.get(KEY)).toBeUndefined()

    open()
    await done

    expect(mocks.store.get(KEY)).toEqual([expect.objectContaining({ hash: 'h1' })])
    expect(release).toHaveBeenCalledWith('h1')
  })

  it('keeps the given publishedAt', async () => {
    await tracker.trackPublished(tx({ publishedAt: NOW - 5000 }))

    expect(tracker.useTrackedTransactions().get('h1')?.tx.publishedAt).toBe(NOW - 5000)
    expect((mocks.store.get(KEY) as { publishedAt: number }[])[0].publishedAt).toBe(NOW - 5000)
  })

  it('never rejects when the release fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    release.mockRejectedValue(new Error('storage gone'))

    await expect(tracker.trackPublished(tx())).resolves.toBeUndefined()
  })
})

describe('trackTransaction', () => {
  const block = { hash: { toString: () => 'h9' }, address: { toString: () => 'z1from' } }

  it('stores no meta key without meta', async () => {
    await tracker.trackTransaction('Send', block as never)

    const [stored] = mocks.store.get(KEY) as Record<string, unknown>[]
    expect(stored).toMatchObject({ hash: 'h9', label: 'Send', address: 'z1from' })
    expect('meta' in stored).toBe(false)
  })

  it('stores the given meta and releases the record', async () => {
    const meta = { kind: 'send' as const, title: 'Send ZNN', recipient: 'z1to' }

    await tracker.trackTransaction('Send', block as never, meta)

    expect((mocks.store.get(KEY) as { meta: unknown }[])[0].meta).toEqual(meta)
    expect(release).toHaveBeenCalledWith('h9')
  })

  it('resolves and warns when the block cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(tracker.trackTransaction('Send', {} as never)).resolves.toBeUndefined()
  })
})

describe('trackRejected', () => {
  const input = {
    label: 'Send ZNN',
    address: 'z1from',
    reason: 'insufficient balance',
    node: 'node.zenonhub.io',
    meta: { kind: 'send' as const, title: 'Send ZNN', recipient: 'z1to' },
  }

  it('adds a done rejected entry with the reason, node and meta', () => {
    const id = tracker.trackRejected(input)

    expect(id.startsWith('rejected-')).toBe(true)
    expect(tracker.useTrackedTransactions().get(id)).toMatchObject({
      stage: { kind: 'rejected', reason: 'insufficient balance', node: 'node.zenonhub.io' },
      done: true,
      tx: { hash: id, label: 'Send ZNN', address: 'z1from', meta: input.meta },
    })
  })

  it('gives each rejection its own id', () => {
    expect(tracker.trackRejected(input)).not.toBe(tracker.trackRejected(input))
  })

  it('omits meta when none is given', () => {
    const id = tracker.trackRejected({ ...input, meta: undefined })

    expect('meta' in tracker.useTrackedTransactions().get(id)!.tx).toBe(false)
  })

  it('shows no toast, writes no storage, reads no block and emits no progress', async () => {
    const listener = vi.fn()
    tracker.onTxProgress(listener)

    tracker.trackRejected(input)
    await poll(3)

    Object.values(mocks.toast).forEach((fn) => expect(fn).not.toHaveBeenCalled())
    expect(mocks.store.has(KEY)).toBe(false)
    expect(mocks.getAccountBlock).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })
})

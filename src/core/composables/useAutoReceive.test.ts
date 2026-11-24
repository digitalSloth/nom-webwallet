import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'

import {
  AUTO_RECEIVE_LOCK,
  AUTO_RECEIVE_MAX_BACKOFF_MS,
  AUTO_RECEIVE_MAX_PAGES,
  AUTO_RECEIVE_PAGE_SIZE,
  AUTO_RECEIVE_POW_LIMIT,
  AUTO_RECEIVE_POW_WINDOW_MS,
  AUTO_RECEIVE_RETRY_MS,
} from '@/config'

const mocks = vi.hoisted(() => ({
  getAccountInfo: vi.fn(),
  getUnreceivedBlocks: vi.fn(),
  receiveTransaction: vi.fn(),
  getRequiredPoW: vi.fn(),
  toast: { loading: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  stored: new Map<string, unknown>(),
  noteActivity: vi.fn(),
  enabled: null as unknown as { value: boolean },
}))

vi.mock('../account-service', () => ({
  AccountService: {
    getInstance: () => ({
      getAccountInfo: mocks.getAccountInfo,
      getUnreceivedBlocks: mocks.getUnreceivedBlocks,
      getRequiredPoWForReceive: mocks.getRequiredPoW,
    }),
  },
}))
vi.mock('../storage/storage-service', () => ({
  storageService: {
    get: async (key: string) => mocks.stored.get(key),
    set: async (key: string, value: unknown) => void mocks.stored.set(key, value),
  },
}))
vi.mock('./useTransaction', () => ({
  useTransaction: () => ({ receiveTransaction: mocks.receiveTransaction }),
}))
vi.mock('./useWallet', () => ({ useWallet: () => ({}) }))
vi.mock('../transaction-service', () => ({
  PublishRejectedError: class PublishRejectedError extends Error {
    reason: string
    constructor(reason: string) {
      super(reason)
      this.reason = reason
    }
  },
  SendSuspendedError: class SendSuspendedError extends Error {},
}))
vi.mock('nom-ui', () => ({ useToast: () => ({ toast: mocks.toast }) }))
vi.mock('../web-session', () => ({ noteActivity: mocks.noteActivity }))
vi.mock('../key-cache', () => ({ noteActivity: mocks.noteActivity }))
vi.mock('./useAutoReceiveSetting', async () => {
  const { ref: makeRef } = await import('vue')
  mocks.enabled = makeRef(false)
  return { useAutoReceiveSetting: () => ({ enabled: mocks.enabled }) }
})

import { trackPow } from '../pow-status'
import { holdSendLock } from '../send-status'
import { sessionManager } from '../session-manager'
import { PublishRejectedError, SendSuspendedError } from '../transaction-service'
import { startAutoReceive } from './useAutoReceive'
import { receiving } from './useIncoming'

const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()
const HELD = 'zts1held'
const ZERO = 'zts1zero'
const SPAM = 'zts1spam'
const ADDRESS = 'z1addr'
const FIVE = 500_000_000n
// Every mocked list and loop is bounded: a runaway runner fails here instead of hanging.
const NODE_CALL_CAP = 200

interface Deferred {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
}
function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (err: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface FakeBlock {
  hash: { toString: () => string }
  tokenStandard: { toString: () => string }
  amount: bigint
  token?: { symbol: string; decimals: number }
}

function block(
  n: number,
  zts = ZNN,
  token: FakeBlock['token'] | null = { symbol: 'ZNN', decimals: 8 }
): FakeBlock {
  const fake: FakeBlock = {
    hash: { toString: () => `hash${n}` },
    tokenStandard: { toString: () => zts },
    amount: FIVE,
  }
  if (token) fake.token = token
  return fake
}

function makeDeps() {
  return {
    wallet: {
      activeWallet: ref<unknown>({ baseAddress: 'z1base', accounts: [] }),
      activeAccountAddress: ref<string | null>(ADDRESS),
      isActiveWalletUnlocked: ref(true),
    },
    account: { unreceivedCount: ref(0), loadUnreceivedCount: vi.fn().mockResolvedValue(undefined) },
    network: {
      isConnected: ref(true),
      nodeDown: ref(false),
      chainId: ref(1),
      currentNode: ref('node-a'),
    },
  }
}
type Deps = ReturnType<typeof makeDeps>

let unreceived: FakeBlock[]
let gates: Deferred[]
let failing: Error | null
let held: boolean
let nodeCalls: number
let stops: Array<() => void>
const lockRequest = vi.fn()

function start(deps: Deps = makeDeps()): { deps: Deps; stop: () => void } {
  const stop = startAutoReceive(deps as never)
  stops.push(stop)
  return { deps, stop }
}

// Flushes queued promises and zero-delay timers without moving the clock.
async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0)
}
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)

const received = () => mocks.receiveTransaction.mock.calls.map((call) => call[2])
const receiveCall = (index: number) => mocks.receiveTransaction.mock.calls[index]

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  unreceived = []
  gates = []
  failing = null
  held = false
  nodeCalls = 0
  stops = []
  receiving.clear()
  mocks.stored.clear()
  mocks.enabled.value = true
  for (const fn of [
    mocks.getAccountInfo,
    mocks.getUnreceivedBlocks,
    mocks.receiveTransaction,
    mocks.getRequiredPoW,
    mocks.noteActivity,
    lockRequest,
    ...Object.values(mocks.toast),
  ]) {
    fn.mockReset()
  }
  mocks.getAccountInfo.mockImplementation(async () => {
    if (++nodeCalls > NODE_CALL_CAP) throw new Error('mock call cap')
    return {
      balanceInfoMap: {
        [ZNN]: { balance: 1n },
        [HELD]: { balance: 3n },
        [ZERO]: { balance: 0n },
      },
    }
  })
  mocks.getRequiredPoW.mockResolvedValue(0)
  mocks.getUnreceivedBlocks.mockImplementation(async (_address, page: number, size: number) => ({
    list: unreceived.slice(page * size, (page + 1) * size),
    more: (page + 1) * size < unreceived.length,
    count: unreceived.length,
  }))
  mocks.receiveTransaction.mockImplementation(
    async (_wallet, _address, hash: string, _meta, beforePublish?: () => void) => {
      const gate = deferred()
      gates.push(gate)
      await gate.promise
      if (failing) throw failing
      beforePublish?.()
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    }
  )
  lockRequest.mockImplementation(async (_name, _options, callback) =>
    callback(held ? null : { name: AUTO_RECEIVE_LOCK })
  )
  vi.stubGlobal('navigator', { locks: { request: lockRequest } })
  // Long fake-time advances must not expire the session on their own.
  sessionManager.attach({ isExpired: () => false, unlocked: () => {}, locked: () => {} })
  sessionManager.drop(null)
  sessionManager.unlock('z1base', {} as never)
})

afterEach(() => {
  for (const stop of stops) stop()
  for (const gate of gates) gate.resolve()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Resolves each receive as it starts, until `limit` receives have started.
async function autoRelease(limit = 20): Promise<void> {
  for (let i = 0; i < limit; i++) {
    await settle()
    const gate = gates[i]
    if (!gate) return
    gate.resolve()
  }
}

describe('eligibility', () => {
  it('reads and receives nothing while the setting is off', async () => {
    mocks.enabled.value = false
    unreceived = [block(1)]

    start()
    await settle()
    await advance(AUTO_RECEIVE_MAX_BACKOFF_MS)

    expect(mocks.getAccountInfo).not.toHaveBeenCalled()
    expect(mocks.getUnreceivedBlocks).not.toHaveBeenCalled()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('starts when the setting turns on', async () => {
    mocks.enabled.value = false
    unreceived = [block(1)]
    start()
    await settle()

    mocks.enabled.value = true
    await settle()

    expect(received()).toEqual(['hash1'])
  })

  it.each([
    ['a locked wallet', (d: Deps) => (d.wallet.isActiveWalletUnlocked.value = false)],
    ['no active wallet', (d: Deps) => (d.wallet.activeWallet.value = null)],
    ['no active account', (d: Deps) => (d.wallet.activeAccountAddress.value = null)],
    ['a disconnected network', (d: Deps) => (d.network.isConnected.value = false)],
    ['a node that is down', (d: Deps) => (d.network.nodeDown.value = true)],
  ])('reads and receives nothing with %s', async (_name, ineligible) => {
    const deps = makeDeps()
    ineligible(deps)
    unreceived = [block(1)]

    start(deps)
    await settle()
    await advance(AUTO_RECEIVE_RETRY_MS * 4)

    expect(mocks.getAccountInfo).not.toHaveBeenCalled()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('reads and receives only for the active account', async () => {
    unreceived = [block(1)]
    const { deps } = start()

    await autoRelease()

    expect(mocks.getAccountInfo).toHaveBeenCalledWith(ADDRESS)
    expect(mocks.getUnreceivedBlocks).toHaveBeenCalledWith(ADDRESS, 0, AUTO_RECEIVE_PAGE_SIZE)
    expect(receiveCall(0)[0]).toBe(deps.wallet.activeWallet.value)
    expect(receiveCall(0)[1]).toBe(ADDRESS)
  })
})

describe('which blocks it receives', () => {
  it('receives ZNN, QSR and a held token in list order, one at a time, with background meta', async () => {
    unreceived = [
      block(1),
      block(2, QSR, { symbol: 'QSR', decimals: 8 }),
      block(3, HELD, { symbol: 'HLD', decimals: 8 }),
      block(4, SPAM, { symbol: 'SPM', decimals: 8 }),
      block(5, ZERO, { symbol: 'ZRO', decimals: 8 }),
    ]
    start()
    await settle()

    expect(received()).toEqual(['hash1'])
    expect(receiveCall(0)[3]).toMatchObject({
      kind: 'receive',
      title: 'Auto-receive 5 ZNN',
      progress: 'Auto-receiving 5 ZNN (1 of 3)',
      background: true,
    })
    expect(receiveCall(0)[4]).toBeTypeOf('function')

    gates[0].resolve()
    await settle()
    expect(received()).toEqual(['hash1', 'hash2'])
    expect(receiveCall(1)[3]).toMatchObject({
      title: 'Auto-receive 5 QSR',
      background: true,
    })

    gates[1].resolve()
    await settle()
    expect(received()).toEqual(['hash1', 'hash2', 'hash3'])

    gates[2].resolve()
    await settle()
    await advance(60 * 60_000)

    expect(received()).toEqual(['hash1', 'hash2', 'hash3'])
    expect(unreceived.map((b) => b.hash.toString())).toEqual(['hash4', 'hash5'])
  })

  it('receives a ZNN or QSR block that has no token object', async () => {
    unreceived = [block(1, ZNN, null), block(2, QSR, null)]
    start()

    await autoRelease()

    expect(received()).toEqual(['hash1', 'hash2'])
    expect(receiveCall(0)[3]).toMatchObject({ title: 'Auto-receive 500000000 ZNN' })
    expect(receiveCall(1)[3]).toMatchObject({ title: 'Auto-receive 500000000 QSR' })
  })

  it('skips a block with no token object unless it is ZNN or QSR', async () => {
    unreceived = [block(1, HELD, null)]
    start()

    await autoRelease()

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('never retries a pass that holds only unknown tokens', async () => {
    unreceived = [block(1, SPAM, { symbol: 'SPM', decimals: 8 }), block(2, ZERO)]
    start()
    await settle()
    const reads = mocks.getUnreceivedBlocks.mock.calls.length

    await advance(60 * 60_000)

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(mocks.getUnreceivedBlocks).toHaveBeenCalledTimes(reads)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('skips a hash that is already in the shared receiving set', async () => {
    receiving.add('hash2')
    unreceived = [block(1), block(2), block(3)]
    start()

    await autoRelease()

    expect(received()).toEqual(['hash1', 'hash3'])
    expect(receiving.has('hash2')).toBe(true)
  })

  it('removes its hash from the receiving set when the receive settles', async () => {
    unreceived = [block(1)]
    start()
    await settle()
    expect(receiving.has('hash1')).toBe(true)

    gates[0].resolve()
    await settle()

    expect(receiving.has('hash1')).toBe(false)
  })

  it('receives a ZNN block at index 199 behind spam in a single scan of four pages', async () => {
    unreceived = Array.from({ length: 200 }, (_v, i) =>
      i === 199 ? block(i) : block(i, SPAM, { symbol: 'SPM', decimals: 8 })
    )
    start()
    let readsAtReceive = 0
    mocks.receiveTransaction.mockImplementationOnce(async (_w, _a, hash: string) => {
      readsAtReceive = mocks.getUnreceivedBlocks.mock.calls.length
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    })
    await settle()

    expect(received()).toEqual(['hash199'])
    expect(readsAtReceive).toBe(AUTO_RECEIVE_MAX_PAGES)
  })

  it('does not receive a ZNN block at index 200 and reads at most four pages per pass', async () => {
    unreceived = Array.from({ length: 201 }, (_v, i) =>
      i === 200 ? block(i) : block(i, SPAM, { symbol: 'SPM', decimals: 8 })
    )
    start()

    await settle()
    await advance(60 * 60_000)

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(mocks.getUnreceivedBlocks).toHaveBeenCalledTimes(AUTO_RECEIVE_MAX_PAGES)
    const pages = mocks.getUnreceivedBlocks.mock.calls.map((call) => call[1])
    expect(pages).toEqual([0, 1, 2, 3])
  })

  it('stops scanning when a page reports no more blocks', async () => {
    unreceived = [block(1)]
    start()

    await autoRelease()

    for (const call of mocks.getUnreceivedBlocks.mock.calls) expect(call[1]).toBe(0)
  })
})

describe('one receiver at a time', () => {
  it('asks for the lock without waiting and receives nothing while another document holds it', async () => {
    held = true
    unreceived = [block(1)]
    start()
    await settle()

    expect(lockRequest).toHaveBeenCalledWith(
      AUTO_RECEIVE_LOCK,
      { ifAvailable: true },
      expect.any(Function)
    )
    expect(mocks.getAccountInfo).not.toHaveBeenCalled()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()

    await advance(AUTO_RECEIVE_RETRY_MS - 1)
    expect(lockRequest).toHaveBeenCalledTimes(1)
    held = false
    await advance(1)
    await settle()

    expect(received()).toEqual(['hash1'])
  })

  it('keeps retrying every retry interval while the lock stays held', async () => {
    held = true
    unreceived = [block(1)]
    start()
    await settle()

    await advance(AUTO_RECEIVE_RETRY_MS * 3)

    expect(lockRequest).toHaveBeenCalledTimes(4)
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('never receives without Web Locks and warns once', async () => {
    vi.stubGlobal('navigator', {})
    unreceived = [block(1)]
    const { deps } = start()
    await settle()

    deps.account.unreceivedCount.value = 1
    await settle()
    deps.account.unreceivedCount.value = 2
    await settle()
    await advance(60 * 60_000)

    expect(mocks.getAccountInfo).not.toHaveBeenCalled()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledTimes(1)
  })
})

describe('immediate stop', () => {
  const cases: Array<[string, (deps: Deps, stop: () => void) => void]> = [
    ['a lock through the session', () => sessionManager.drop('z1base')],
    ['a lock through the wallet', (d) => (d.wallet.isActiveWalletUnlocked.value = false)],
    ['an account switch', (d) => (d.wallet.activeAccountAddress.value = 'z1other')],
    ['a wallet switch', (d) => (d.wallet.activeWallet.value = { baseAddress: 'z1second' })],
    ['a chain id change', (d) => (d.network.chainId.value = 2)],
    ['a node change', (d) => (d.network.currentNode.value = 'node-b')],
    ['the setting turning off', () => (mocks.enabled.value = false)],
    ['the node going down', (d) => (d.network.nodeDown.value = true)],
    ['the stop function', (_d, stop) => stop()],
  ]

  it.each(cases)(
    'never publishes the block in PoW and starts no later block on %s',
    async (_name, change) => {
      unreceived = [block(1), block(2)]
      const { deps, stop } = start()
      await settle()
      expect(received()).toEqual(['hash1'])
      const beforePublish = receiveCall(0)[4] as () => void
      expect(() => beforePublish()).not.toThrow()

      unreceived = []
      change(deps, stop)

      expect(() => beforePublish()).toThrow('Auto-receive stopped before publishing')
      expect(mocks.toast.dismiss).toHaveBeenCalledWith('auto-receive')

      gates[0].resolve()
      await settle()
      await advance(60 * 60_000)

      expect(received()).toEqual(['hash1'])
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(receiving.has('hash1')).toBe(false)
    }
  )

  it('hides the progress toast text from a stopped pass', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()
    deps.wallet.isActiveWalletUnlocked.value = false
    const shown = mocks.toast.loading.mock.calls.length

    const gate = deferred()
    const pow = trackPow(() => gate.promise)()
    await settle()
    gate.resolve()
    await pow

    expect(mocks.toast.loading).toHaveBeenCalledTimes(shown)
  })

  it('treats a suspended send as a stop with no toast and no retry', async () => {
    unreceived = [block(1), block(2)]
    start()
    await settle()
    failing = new SendSuspendedError()
    gates[0].resolve()
    await settle()
    await advance(60 * 60_000)

    expect(received()).toEqual(['hash1'])
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('starts a fresh run, receiving the block again, when the wallet unlocks again', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()
    deps.wallet.isActiveWalletUnlocked.value = false
    gates[0].resolve()
    await settle()
    expect(unreceived).toHaveLength(1)

    deps.wallet.isActiveWalletUnlocked.value = true
    await autoRelease()

    expect(received()).toEqual(['hash1', 'hash1'])
    expect(unreceived).toHaveLength(0)
  })
})

describe('failure and backoff', () => {
  it('shows one error toast, retries after 30 s then 60 s, and resets after a success', async () => {
    unreceived = [block(1)]
    failing = new Error('boom')
    start()
    await settle()
    gates[0].resolve()
    await settle()

    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
    expect(mocks.toast.error).toHaveBeenCalledWith('Auto-receive failed: boom', {
      id: 'auto-receive-failed',
      duration: 15_000,
    })

    await advance(AUTO_RECEIVE_RETRY_MS - 1)
    expect(received()).toHaveLength(1)
    await advance(1)
    await settle()
    expect(received()).toHaveLength(2)
    gates[1].resolve()
    await settle()

    await advance(AUTO_RECEIVE_RETRY_MS * 2 - 1)
    expect(received()).toHaveLength(2)
    await advance(1)
    await settle()
    expect(received()).toHaveLength(3)
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)

    failing = null
    gates[2].resolve()
    await settle()
    expect(unreceived).toHaveLength(0)
    expect(received()).toHaveLength(3)
  })

  it('restarts the backoff at 30 s after a success', async () => {
    unreceived = [block(1)]
    failing = new Error('boom')
    const { deps } = start()
    await settle()
    gates[0].resolve()
    await settle()
    await advance(AUTO_RECEIVE_RETRY_MS)
    await settle()
    gates[1].resolve()
    await settle()
    expect(received()).toHaveLength(2)

    failing = null
    await advance(AUTO_RECEIVE_RETRY_MS * 2)
    await settle()
    gates[2].resolve()
    await settle()
    expect(unreceived).toHaveLength(0)
    expect(deps.account.loadUnreceivedCount).toHaveBeenCalledTimes(1)

    failing = new Error('again')
    unreceived = [block(2)]
    deps.account.unreceivedCount.value = 1
    await settle()
    gates[3].resolve()
    await settle()
    expect(mocks.toast.error).toHaveBeenCalledTimes(2)
    expect(received()).toHaveLength(4)

    await advance(AUTO_RECEIVE_RETRY_MS - 1)
    expect(received()).toHaveLength(4)
    await advance(1)
    await settle()
    expect(received()).toHaveLength(5)
  })

  it('doubles the delay up to the 10 minute cap with a single toast', async () => {
    unreceived = [block(1)]
    failing = new Error('boom')
    start()
    await settle()
    const second = 1000
    const checkpoints: Array<[number, number]> = [
      [30 * second, 2],
      [90 * second, 3],
      [210 * second, 4],
      [450 * second, 5],
      [930 * second, 6],
      [1530 * second, 7],
      [2130 * second, 8],
    ]
    expect(AUTO_RECEIVE_MAX_BACKOFF_MS).toBe(600 * second)

    let now = 0
    for (const [at, calls] of checkpoints) {
      gates.forEach((gate) => gate.resolve())
      await advance(at - now - 1)
      await settle()
      gates.forEach((gate) => gate.resolve())
      await settle()
      expect(received()).toHaveLength(calls - 1)
      await advance(1)
      await settle()
      gates.forEach((gate) => gate.resolve())
      await settle()
      expect(received()).toHaveLength(calls)
      now = at
    }
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })

  it('backs off and toasts when the node read throws', async () => {
    mocks.getAccountInfo.mockRejectedValueOnce(new Error('node unreachable'))
    unreceived = [block(1)]
    start()
    await settle()

    expect(mocks.toast.error).toHaveBeenCalledWith(
      'Auto-receive failed: node unreachable',
      expect.objectContaining({ id: 'auto-receive-failed' })
    )
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()

    await advance(AUTO_RECEIVE_RETRY_MS - 1)
    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(1)
    await advance(1)
    await settle()
    expect(received()).toEqual(['hash1'])
  })

  it('skips a block the node says is already received without a toast', async () => {
    unreceived = [block(1), block(2)]
    start()
    await settle()
    failing = new PublishRejectedError('account-block from-block already received (node said so)')
    gates[0].resolve()
    await settle()
    failing = null
    gates[1]?.resolve()
    await autoRelease()

    expect(received()).toEqual(['hash1', 'hash2'])
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('treats any other node refusal as a failure', async () => {
    unreceived = [block(1)]
    start()
    await settle()
    failing = new PublishRejectedError('account-block hash mismatch')
    gates[0].resolve()
    await settle()

    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('send coordination', () => {
  it('waits while another send holds the send lock and retries after the retry interval', async () => {
    const hold = deferred()
    const held = holdSendLock(() => hold.promise)
    unreceived = [block(1)]
    start()
    await settle()

    expect(mocks.getAccountInfo).not.toHaveBeenCalled()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()

    hold.resolve()
    await held
    await advance(AUTO_RECEIVE_RETRY_MS - 1)
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    await advance(1)
    await settle()

    expect(received()).toEqual(['hash1'])
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('starts no further block while a send holds the lock mid-pass', async () => {
    unreceived = [block(1), block(2)]
    start()
    await settle()
    const hold = deferred()
    const held = holdSendLock(() => hold.promise)

    gates[0].resolve()
    await settle()
    expect(received()).toEqual(['hash1'])

    hold.resolve()
    await held
    await advance(AUTO_RECEIVE_RETRY_MS)
    await settle()

    expect(received()).toEqual(['hash1', 'hash2'])
  })

  it('does not count as user activity', async () => {
    unreceived = [block(1)]
    start()

    await autoRelease()

    expect(received()).toEqual(['hash1'])
    expect(mocks.noteActivity).not.toHaveBeenCalled()
  })
})

describe('progress toast', () => {
  it('shows the position and the PoW state, then dismisses at the end of the pass', async () => {
    unreceived = [block(1), block(2)]
    start()
    await settle()

    expect(mocks.toast.loading).toHaveBeenLastCalledWith('Auto-receiving 5 ZNN (1 of 2)', {
      id: 'auto-receive',
    })

    const powGate = deferred()
    const pow = trackPow(() => powGate.promise)()
    await settle()
    expect(mocks.toast.loading).toHaveBeenLastCalledWith(
      'Auto-receiving 5 ZNN (1 of 2) · generating PoW',
      { id: 'auto-receive' }
    )

    powGate.resolve()
    await pow
    await settle()
    expect(mocks.toast.loading).toHaveBeenLastCalledWith('Auto-receiving 5 ZNN (1 of 2)', {
      id: 'auto-receive',
    })

    gates[0].resolve()
    await settle()
    expect(mocks.toast.loading).toHaveBeenLastCalledWith('Auto-receiving 5 ZNN (2 of 2)', {
      id: 'auto-receive',
    })

    gates[1].resolve()
    await settle()
    expect(mocks.toast.dismiss).toHaveBeenCalledWith('auto-receive')
    const shown = mocks.toast.loading.mock.calls.length

    const lateGate = deferred()
    const late = trackPow(() => lateGate.promise)()
    await settle()
    lateGate.resolve()
    await late

    expect(mocks.toast.loading).toHaveBeenCalledTimes(shown)
  })

  it('omits the position for a single block', async () => {
    unreceived = [block(1)]
    start()
    await settle()

    expect(mocks.toast.loading).toHaveBeenLastCalledWith('Auto-receiving 5 ZNN', {
      id: 'auto-receive',
    })
  })
})

describe('scheduling', () => {
  it('calls loadUnreceivedCount after a pass that received blocks', async () => {
    unreceived = [block(1)]
    const { deps } = start()

    await autoRelease()

    expect(deps.account.loadUnreceivedCount).toHaveBeenCalledTimes(1)
  })

  it('starts no pass after an idle pass until the unreceived count changes above zero', async () => {
    const { deps } = start()
    await settle()
    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(1)

    await advance(60 * 60_000)
    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(1)
    expect(deps.account.loadUnreceivedCount).not.toHaveBeenCalled()

    deps.account.unreceivedCount.value = 0
    await settle()
    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(1)

    unreceived = [block(1)]
    deps.account.unreceivedCount.value = 1
    await settle()
    expect(received()).toEqual(['hash1'])
  })

  it('does not start a pass when the count drops to zero', async () => {
    const { deps } = start()
    deps.account.unreceivedCount.value = 3
    await settle()
    const reads = mocks.getAccountInfo.mock.calls.length

    deps.account.unreceivedCount.value = 0
    await settle()

    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(reads)
  })

  it('does not let a count change jump a pending backoff', async () => {
    unreceived = [block(1)]
    failing = new Error('boom')
    const { deps } = start()
    await settle()
    gates[0].resolve()
    await settle()
    expect(received()).toHaveLength(1)

    deps.account.unreceivedCount.value = 5
    await advance(AUTO_RECEIVE_RETRY_MS - 1)

    expect(received()).toHaveLength(1)
  })

  it('runs one more pass after a count change that arrives during a pass', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()

    unreceived = [block(1), block(2)]
    deps.account.unreceivedCount.value = 2
    await settle()
    expect(received()).toEqual(['hash1'])

    await autoRelease()

    expect(received()).toEqual(['hash1', 'hash2'])
  })

  it('never overlaps two passes in one document', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()

    deps.account.unreceivedCount.value = 1
    await settle()
    deps.account.unreceivedCount.value = 2
    await settle()

    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(1)
    expect(received()).toEqual(['hash1'])
  })
})

describe('the stop function', () => {
  it('clears the retry timer so no node read happens afterwards', async () => {
    unreceived = [block(1)]
    failing = new Error('boom')
    const { stop } = start()
    await settle()
    gates[0].resolve()
    await settle()
    const reads = mocks.getAccountInfo.mock.calls.length

    stop()
    await advance(AUTO_RECEIVE_MAX_BACKOFF_MS * 10)

    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(reads)
  })

  it('stops reacting to count changes and setting changes', async () => {
    const { deps, stop } = start()
    await settle()
    const reads = mocks.getAccountInfo.mock.calls.length

    stop()
    unreceived = [block(1)]
    deps.account.unreceivedCount.value = 4
    mocks.enabled.value = false
    mocks.enabled.value = true
    await advance(AUTO_RECEIVE_MAX_BACKOFF_MS)

    expect(mocks.getAccountInfo).toHaveBeenCalledTimes(reads)
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('is safe to call twice', async () => {
    const { stop } = start()
    await settle()

    stop()

    expect(() => stop()).not.toThrow()
  })
})

describe('paging without the node more flag', () => {
  it('finds a ZNN block behind spam on page 2 when more is false on every page', async () => {
    unreceived = Array.from({ length: 120 }, (_v, i) =>
      i === 60 ? block(i) : block(i, SPAM, { symbol: 'SPM', decimals: 8 })
    )
    mocks.getUnreceivedBlocks.mockImplementation(async (_a, page: number, size: number) => ({
      list: unreceived.slice(page * size, (page + 1) * size),
      more: false,
      count: unreceived.length,
    }))
    start()
    let readsAtReceive = 0
    mocks.receiveTransaction.mockImplementationOnce(async (_w, _a, hash: string) => {
      readsAtReceive = mocks.getUnreceivedBlocks.mock.calls.length
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    })
    await settle()

    expect(received()).toEqual(['hash60'])
    expect(readsAtReceive).toBe(3)
  })

  it('reads at most the page cap when every page is full and more is false', async () => {
    unreceived = Array.from({ length: 400 }, (_v, i) =>
      block(i, SPAM, { symbol: 'SPM', decimals: 8 })
    )
    mocks.getUnreceivedBlocks.mockImplementation(async (_a, page: number, size: number) => ({
      list: unreceived.slice(page * size, (page + 1) * size),
      more: false,
      count: unreceived.length,
    }))
    start()
    await settle()
    await advance(60 * 60_000)

    expect(mocks.getUnreceivedBlocks).toHaveBeenCalledTimes(AUTO_RECEIVE_MAX_PAGES)
  })
})

describe('already received refusals', () => {
  it('skips the block for the run, keeps the backoff and never loops PoW', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()
    failing = new PublishRejectedError('account-block from-block already received')
    gates[0].resolve()
    await settle()
    await advance(60 * 60_000)
    deps.account.unreceivedCount.value = 3
    await advance(60 * 60_000)

    expect(received()).toEqual(['hash1'])
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(deps.account.loadUnreceivedCount).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not reset a failure backoff', async () => {
    unreceived = [block(1)]
    const { deps } = start()
    await settle()
    failing = new Error('node down')
    gates[0].resolve()
    await settle()
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)

    failing = new PublishRejectedError('account-block from-block already received')
    await advance(AUTO_RECEIVE_RETRY_MS)
    gates[1].resolve()
    await settle()
    expect(received()).toEqual(['hash1', 'hash1'])

    unreceived = [block(2)]
    failing = new Error('node down')
    deps.account.unreceivedCount.value = 2
    await settle()
    gates[2].resolve()
    await settle()
    expect(received()).toEqual(['hash1', 'hash1', 'hash2'])

    await advance(AUTO_RECEIVE_RETRY_MS)
    await settle()
    expect(received()).toHaveLength(3)
    await advance(AUTO_RECEIVE_RETRY_MS)
    await settle()
    expect(received()).toHaveLength(4)
    expect(mocks.toast.error).toHaveBeenCalledTimes(1)
  })
})

describe('PoW receive cap', () => {
  const POW_KEY = 'nom-wallet-auto-receive-pow'
  const stamps = (): number[] => (mocks.stored.get(POW_KEY) as number[] | undefined) ?? []

  function powReceives(): void {
    mocks.getRequiredPoW.mockResolvedValue(1_000)
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    })
  }

  it('pauses after the limit with one notice and resumes after the window', async () => {
    powReceives()
    unreceived = Array.from({ length: AUTO_RECEIVE_POW_LIMIT + 5 }, (_v, i) => block(i))
    const { deps } = start()
    await settle()

    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT)
    expect(mocks.toast.info).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)

    deps.account.unreceivedCount.value = 5
    await advance(AUTO_RECEIVE_POW_WINDOW_MS - 2_000)
    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT)
    expect(mocks.toast.info).toHaveBeenCalledTimes(1)

    await advance(2_000)
    await settle()
    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT + 5)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('counts a block with a non-zero required difficulty whatever the plasma level', async () => {
    powReceives()
    unreceived = [block(1)]
    start()
    await settle()

    expect(mocks.getRequiredPoW).toHaveBeenCalledWith(ADDRESS)
    expect(stamps()).toHaveLength(1)
  })

  it('keeps receiving over the limit while no PoW is required', async () => {
    unreceived = Array.from({ length: AUTO_RECEIVE_POW_LIMIT + 3 }, (_v, i) => block(i))
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    })
    start()
    await settle()

    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT + 3)
    expect(mocks.toast.info).not.toHaveBeenCalled()
    expect(stamps()).toHaveLength(0)
  })

  it('stops a run over the limit once a block needs PoW', async () => {
    mocks.stored.set(
      POW_KEY,
      Array.from({ length: AUTO_RECEIVE_POW_LIMIT }, () => Date.now())
    )
    unreceived = [block(1), block(2)]
    mocks.getRequiredPoW.mockResolvedValueOnce(0).mockResolvedValue(1_000)
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      unreceived = unreceived.filter((b) => b.hash.toString() !== hash)
      return {}
    })
    start()
    await settle()

    expect(received()).toEqual(['hash1'])
    expect(mocks.toast.info).toHaveBeenCalledTimes(1)
  })

  it('counts PoW that ends in a node refusal and pauses on the next fresh hash', async () => {
    mocks.getRequiredPoW.mockResolvedValue(1_000)
    mocks.stored.set(
      POW_KEY,
      Array.from({ length: AUTO_RECEIVE_POW_LIMIT - 1 }, () => Date.now())
    )
    unreceived = [block(1)]
    mocks.receiveTransaction.mockRejectedValue(
      new PublishRejectedError('account-block from-block already received')
    )
    const { deps } = start()
    await settle()

    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(1)
    expect(stamps()).toHaveLength(AUTO_RECEIVE_POW_LIMIT)

    unreceived = [block(2)]
    deps.account.unreceivedCount.value = 1
    await settle()

    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.toast.info).toHaveBeenCalledTimes(1)
  })

  it('counts PoW that fails', async () => {
    mocks.getRequiredPoW.mockResolvedValue(1_000)
    unreceived = [block(1)]
    mocks.receiveTransaction.mockRejectedValue(new Error('boom'))
    start()
    await settle()

    expect(stamps()).toHaveLength(1)
  })

  it('counts PoW that a session expiry stops', async () => {
    mocks.getRequiredPoW.mockResolvedValue(1_000)
    unreceived = [block(1)]
    mocks.receiveTransaction.mockImplementation(
      async (_w, _a, _hash: string, _meta, beforePublish?: () => void) => {
        sessionManager.drop(null)
        beforePublish?.()
        return {}
      }
    )
    start()
    await settle()

    expect(stamps()).toHaveLength(1)
  })

  it('counts a receive with no PoW worker the same way', async () => {
    // The count comes from the node's difficulty, not from the PoW provider.
    powReceives()
    unreceived = [block(1), block(2)]
    start()
    await settle()

    expect(stamps()).toHaveLength(2)
  })

  it('holds the cap after a reload and in a second tab', async () => {
    powReceives()
    unreceived = Array.from({ length: AUTO_RECEIVE_POW_LIMIT + 2 }, (_v, i) => block(i))
    const first = start()
    await settle()
    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT)

    first.stop()
    const second = start()
    await settle()

    expect(mocks.receiveTransaction).toHaveBeenCalledTimes(AUTO_RECEIVE_POW_LIMIT)
    expect(mocks.toast.info).toHaveBeenCalledTimes(2)
    second.stop()
  })

  it('counts receives saved by an earlier document on the same device', async () => {
    powReceives()
    mocks.stored.set(
      POW_KEY,
      Array.from({ length: AUTO_RECEIVE_POW_LIMIT }, () => Date.now())
    )
    unreceived = [block(1)]
    start()
    await settle()

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(mocks.toast.info).toHaveBeenCalledTimes(1)
  })
})

describe('session expiry', () => {
  it('receives nothing and shows no error when the session expires before the refs update', async () => {
    unreceived = [block(1)]
    start()
    sessionManager.drop(null)
    await settle()
    await advance(60_000)

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

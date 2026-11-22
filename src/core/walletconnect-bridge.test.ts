import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { shallowRef } from 'vue'
import type { SessionTypes } from '@walletconnect/types'

import {
  SESSION_KEY_WALLETCONNECT_COMMAND as COMMAND_KEY,
  SESSION_KEY_WALLETCONNECT_PAIR_RESULT as PAIR_RESULT_KEY,
  SESSION_KEY_WALLETCONNECT_WINDOW_ID as WINDOW_KEY,
  STORAGE_KEY_WC_SESSION_SUMMARY as SUMMARY_KEY,
} from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'
import {
  activeSessions,
  clearPairResult,
  openWalletConnectWindow,
  readPairResult,
  readSessionSummary,
  sendWalletConnectCommand,
  startWalletConnectHostBridge,
  type WalletConnectHost,
} from './walletconnect-bridge'

const metaMock = vi.hoisted(() => ({
  readSessionMeta: vi.fn(
    async (): Promise<Record<string, { verification: string; approvedAt: number }>> => ({})
  ),
}))
vi.mock('./walletconnect-session-meta', () => metaMock)

let fake: ReturnType<typeof installFakeChrome>

const session = (topic: string, over: Record<string, unknown> = {}, icons?: string[]) =>
  ({
    topic,
    expiry: 2_000_000_000,
    peer: {
      metadata: {
        name: `dApp ${topic}`,
        url: 'https://dapp.example',
        icons: icons ?? ['https://dapp.example/icon.png'],
      },
    },
    ...over,
  }) as unknown as SessionTypes.Struct

type MockHost = WalletConnectHost & {
  initialize: Mock<() => Promise<void>>
  pair: Mock<(uri: string) => Promise<void>>
  disconnect: Mock<(topic: string) => Promise<void>>
}

function makeHost(over: Partial<WalletConnectHost> = {}, sessions: SessionTypes.Struct[] = []) {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const initialized = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const sessionRef = shallowRef(sessions)
  const host = {
    isEnabled: true,
    sessions: sessionRef,
    initialize: vi.fn(() => initialized),
    pair: vi.fn<(uri: string) => Promise<void>>(async () => {}),
    disconnect: vi.fn<(topic: string) => Promise<void>>(async () => {}),
    ...over,
  }
  return { host: host as unknown as MockHost, sessionRef, resolve, reject }
}

const command = (body: Record<string, unknown>, id = 'c1') => ({ id, ...body })

beforeEach(() => {
  fake = installFakeChrome({ emitChanges: true })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  metaMock.readSessionMeta.mockReset()
  metaMock.readSessionMeta.mockResolvedValue({})
})

describe('activeSessions', () => {
  const now = 1_000_000

  it('drops expired and malformed entries', () => {
    const result = activeSessions(
      [
        { topic: 'live', expiry: now / 1000 + 1, name: 'n', url: 'u', icon: 'https://i/x.png' },
        { topic: 'edge', expiry: now / 1000 },
        { topic: 'old', expiry: 1 },
        { topic: 5, expiry: 2_000_000_000 },
        { topic: 'noexp' },
        null,
        'x',
      ],
      now
    )
    expect(result.map((s) => s.topic)).toEqual(['live'])
    expect(result[0]).toEqual({
      topic: 'live',
      name: 'n',
      url: 'u',
      icon: 'https://i/x.png',
      expiry: now / 1000 + 1,
    })
  })

  it('defaults a missing name and url to empty and a missing icon to null', () => {
    expect(activeSessions([{ topic: 't', expiry: 2_000_000_000 }], now)[0]).toMatchObject({
      name: '',
      url: '',
      icon: null,
    })
  })

  it('drops a stored icon that is not an https URL', () => {
    const icons = ['http://a/x.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 5]
    for (const icon of icons) {
      expect(activeSessions([{ topic: 't', expiry: 2_000_000_000, icon }], now)[0].icon).toBeNull()
    }
  })

  it('returns an empty list for a non-array', () => {
    expect(activeSessions({ 0: { topic: 't', expiry: 2_000_000_000 } }, now)).toEqual([])
    expect(activeSessions(null, now)).toEqual([])
  })
})

describe('readSessionSummary', () => {
  it('reads the stored summary and hides expired entries', async () => {
    fake.local.data[SUMMARY_KEY] = [
      { topic: 'a', expiry: 2_000_000_000, name: 'A', url: '', icon: null },
      { topic: 'b', expiry: 1, name: 'B', url: '', icon: null },
    ]
    expect((await readSessionSummary()).map((s) => s.topic)).toEqual(['a'])
  })
})

describe('openWalletConnectWindow', () => {
  it('opens the window without writing a command', async () => {
    await openWalletConnectWindow()

    expect(fake.chrome.windows.create).toHaveBeenCalledTimes(1)
    expect(fake.session.data[WINDOW_KEY]).toBe(101)
    expect(COMMAND_KEY in fake.session.data).toBe(false)
  })
})

describe('sendWalletConnectCommand', () => {
  it('stores the command with a string id before it creates the window', async () => {
    let storedAtCreate: unknown
    fake.chrome.windows.create.mockImplementation(async () => {
      storedAtCreate = fake.session.data[COMMAND_KEY]
      return { id: 101 }
    })

    await sendWalletConnectCommand({ kind: 'pair', uri: 'wc:abc' })

    expect(storedAtCreate).toMatchObject({ kind: 'pair', uri: 'wc:abc' })
    expect(typeof (storedAtCreate as { id: unknown }).id).toBe('string')
    expect(fake.chrome.windows.create).toHaveBeenCalledWith({
      url: 'chrome-extension://wallet/popup.html?surface=window#/walletconnect',
      type: 'popup',
      width: 420,
      height: 680,
    })
    expect(fake.session.data[WINDOW_KEY]).toBe(101)
  })

  it('gives each command a distinct id', async () => {
    await sendWalletConnectCommand({ kind: 'disconnectAll' })
    const first = (fake.session.data[COMMAND_KEY] as { id: string }).id
    await sendWalletConnectCommand({ kind: 'disconnectAll' })
    expect((fake.session.data[COMMAND_KEY] as { id: string }).id).not.toBe(first)
  })

  it('focuses the stored window instead of creating another', async () => {
    fake.session.data[WINDOW_KEY] = 55

    await sendWalletConnectCommand({ kind: 'disconnectAll' })

    expect(fake.chrome.windows.update).toHaveBeenCalledWith(55, { focused: true })
    expect(fake.chrome.windows.create).not.toHaveBeenCalled()
  })

  it('leaves the command in storage when the window cannot be opened', async () => {
    fake.chrome.windows.create.mockRejectedValue(new Error('no window'))

    await expect(sendWalletConnectCommand({ kind: 'disconnectAll' })).rejects.toThrow('no window')
    expect(fake.session.data[COMMAND_KEY]).toMatchObject({ kind: 'disconnectAll' })
  })
})

describe('startWalletConnectHostBridge summary', () => {
  it('writes nothing before initialize resolves, then the summary', async () => {
    const { host, resolve } = makeHost({}, [session('t1')])
    startWalletConnectHostBridge(host)
    await settleStorage()
    expect(fake.local.data[SUMMARY_KEY]).toBeUndefined()

    resolve()
    await settleStorage()

    expect(fake.local.data[SUMMARY_KEY]).toEqual([
      {
        topic: 't1',
        name: 'dApp t1',
        url: 'https://dapp.example',
        icon: 'https://dapp.example/icon.png',
        expiry: 2_000_000_000,
      },
    ])
  })

  it('rewrites the summary when the sessions change', async () => {
    const { host, sessionRef, resolve } = makeHost({}, [session('t1')])
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    sessionRef.value = [session('t1'), session('t2')]
    await settleStorage()

    expect((fake.local.data[SUMMARY_KEY] as { topic: string }[]).map((s) => s.topic)).toEqual([
      't1',
      't2',
    ])
    sessionRef.value = []
    await settleStorage()
    expect(fake.local.data[SUMMARY_KEY]).toEqual([])
  })

  it('publishes only https icons and falls back for a blank name', async () => {
    const { host, resolve } = makeHost({}, [
      session('http', {}, ['http://dapp.example/i.png']),
      session('none', {}, []),
      session('blank', { peer: { metadata: { name: '', icons: [] } } }),
    ])
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    const summary = fake.local.data[SUMMARY_KEY] as {
      icon: string | null
      name: string
      url: string
    }[]
    expect(summary.map((s) => s.icon)).toEqual([null, null, null])
    expect(summary[2]).toMatchObject({ name: 'Unknown dApp', url: '' })
  })

  it('writes no summary and runs no command when initialize rejects', async () => {
    fake.session.data[COMMAND_KEY] = command({ kind: 'disconnect', topic: 't' })
    const { host, reject } = makeHost()
    startWalletConnectHostBridge(host)
    reject(new Error('init failed'))
    await settleStorage()

    expect(fake.local.data[SUMMARY_KEY]).toBeUndefined()
    expect(host.disconnect).not.toHaveBeenCalled()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()
  })

  it('does nothing when WalletConnect is disabled', async () => {
    fake.session.data[COMMAND_KEY] = command({ kind: 'disconnectAll' })
    const { host, resolve } = makeHost({ isEnabled: false })
    const stop = startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    expect(host.initialize).not.toHaveBeenCalled()
    expect(fake.local.data[SUMMARY_KEY]).toBeUndefined()
    expect(fake.chrome.windows.getCurrent).not.toHaveBeenCalled()
    expect(fake.session.data[WINDOW_KEY]).toBeUndefined()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()
    expect(() => stop()).not.toThrow()
  })

  it('registers the current window id', async () => {
    const { host } = makeHost()
    startWalletConnectHostBridge(host)
    await settleStorage()
    expect(fake.session.data[WINDOW_KEY]).toBe(202)
  })

  it('does not register a window without an id', async () => {
    fake.chrome.windows.getCurrent.mockResolvedValue({})
    const { host } = makeHost()
    startWalletConnectHostBridge(host)
    await settleStorage()
    expect(fake.session.data[WINDOW_KEY]).toBeUndefined()
  })
})

describe('startWalletConnectHostBridge commands', () => {
  it('holds a command stored before start until initialize resolves, then runs it once and removes it', async () => {
    fake.session.data[COMMAND_KEY] = command({ kind: 'pair', uri: 'wc:abc' })
    const { host, resolve } = makeHost()
    startWalletConnectHostBridge(host)
    await settleStorage()
    expect(host.pair).not.toHaveBeenCalled()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()

    resolve()
    await settleStorage()

    expect(host.pair).toHaveBeenCalledTimes(1)
    expect(host.pair).toHaveBeenCalledWith('wc:abc')
    expect(fake.session.data[COMMAND_KEY]).toBeUndefined()
  })

  it('runs a command written after start once, ignoring the remove event', async () => {
    const { host, resolve } = makeHost()
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 't1' }) })
    await settleStorage()

    expect(host.disconnect).toHaveBeenCalledTimes(1)
    expect(host.disconnect).toHaveBeenCalledWith('t1')
    expect(fake.session.data[COMMAND_KEY]).toBeUndefined()
  })

  it('runs a command seen by both the initial read and the change listener only once', async () => {
    const { host, resolve } = makeHost()
    startWalletConnectHostBridge(host)
    await settleStorage()
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:x' }) })
    await settleStorage()
    expect(host.pair).not.toHaveBeenCalled()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()
    resolve()
    // a second listener-driven read racing the post-initialize read
    fake.emitStorageChange(
      { [COMMAND_KEY]: { newValue: command({ kind: 'pair', uri: 'wc:x' }) } },
      'session'
    )
    fake.emitStorageChange(
      { [COMMAND_KEY]: { newValue: command({ kind: 'pair', uri: 'wc:x' }) } },
      'session'
    )
    await settleStorage()

    expect(host.pair).toHaveBeenCalledTimes(1)
  })

  it('does not rerun a command id that was already handled', async () => {
    const { host, resolve } = makeHost()
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 'a' }, 'same') })
    await settleStorage()
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 'a' }, 'same') })
    await settleStorage()

    expect(host.disconnect).toHaveBeenCalledTimes(1)
  })

  it('runs two distinct commands one after the other', async () => {
    const { host, resolve } = makeHost()
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 'a' }, 'one') })
    await settleStorage()
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 'b' }, 'two') })
    await settleStorage()

    expect(host.disconnect.mock.calls).toEqual([['a'], ['b']])
  })

  it('disconnectAll ends every session and continues past a rejection', async () => {
    const { host, resolve } = makeHost(
      {
        disconnect: vi.fn<(topic: string) => Promise<void>>(async (topic) => {
          if (topic === 'b') throw new Error('boom')
        }),
      },
      [session('a'), session('b'), session('c')]
    )
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnectAll' }) })
    await settleStorage()

    expect(host.disconnect.mock.calls).toEqual([['a'], ['b'], ['c']])
    expect(fake.session.data[COMMAND_KEY]).toBeUndefined()
  })

  it('does not throw when pair rejects, and still removes the command', async () => {
    const { host, resolve } = makeHost({
      pair: vi.fn<(uri: string) => Promise<void>>(() => Promise.reject(new Error('bad uri'))),
    })
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:bad' }) })
    await settleStorage()

    expect(host.pair).toHaveBeenCalledTimes(1)
    expect(fake.session.data[COMMAND_KEY]).toBeUndefined()
  })

  it.each([
    ['unknown kind', { id: 'm', kind: 'explode' }],
    ['pair without wc: prefix', { id: 'm', kind: 'pair', uri: 'https://x' }],
    ['disconnect without topic', { id: 'm', kind: 'disconnect' }],
    ['no id', { kind: 'disconnectAll' }],
    ['a string', 'junk'],
  ])('removes a malformed command (%s) and runs nothing', async (_name, value) => {
    fake.session.data[COMMAND_KEY] = value
    const { host, resolve } = makeHost({}, [session('a')])
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    expect(fake.session.data[COMMAND_KEY]).toBeUndefined()
    expect(host.pair).not.toHaveBeenCalled()
    expect(host.disconnect).not.toHaveBeenCalled()
  })

  it('does not run a command written after stop', async () => {
    const { host, resolve } = makeHost()
    const stop = startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()
    stop()

    expect(fake.chrome.storage.onChanged.removeListener).toHaveBeenCalledTimes(1)
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 't' }) })
    await settleStorage()

    expect(host.disconnect).not.toHaveBeenCalled()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()
  })

  it('stops publishing summaries after stop', async () => {
    const { host, sessionRef, resolve } = makeHost({}, [session('a')])
    const stop = startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()
    stop()

    sessionRef.value = [session('a'), session('b')]
    await settleStorage()

    expect(fake.local.data[SUMMARY_KEY] as unknown[]).toHaveLength(1)
  })

  it('does nothing when stopped before initialize resolves', async () => {
    fake.session.data[COMMAND_KEY] = command({ kind: 'disconnectAll' })
    const { host, resolve } = makeHost()
    const stop = startWalletConnectHostBridge(host)
    stop()
    resolve()
    await settleStorage()

    expect(fake.local.data[SUMMARY_KEY]).toBeUndefined()
    expect(fake.session.data[COMMAND_KEY]).toBeDefined()
  })
})

describe('startWalletConnectHostBridge pair result', () => {
  async function started(over: Partial<WalletConnectHost> = {}) {
    const made = makeHost(over, [session('a')])
    startWalletConnectHostBridge(made.host)
    made.resolve()
    await settleStorage()
    return made
  }

  it('stores ok: true under the command id when the pair resolves', async () => {
    await started()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:abc' }, 'p1') })
    await settleStorage()

    expect(fake.session.data[PAIR_RESULT_KEY]).toEqual({ id: 'p1', ok: true })
  })

  it('stores ok: false under the command id when the pair throws', async () => {
    await started({
      pair: vi.fn<(uri: string) => Promise<void>>(() => Promise.reject(new Error('bad uri'))),
    })

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:bad' }, 'p2') })
    await settleStorage()

    expect(fake.session.data[PAIR_RESULT_KEY]).toEqual({ id: 'p2', ok: false })
  })

  it('keeps only the latest result after two pair commands', async () => {
    let calls = 0
    await started({
      pair: vi.fn<(uri: string) => Promise<void>>(async () => {
        if (++calls === 1) throw new Error('first fails')
      }),
    })

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:one' }, 'p1') })
    await settleStorage()
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'pair', uri: 'wc:two' }, 'p2') })
    await settleStorage()

    expect(fake.session.data[PAIR_RESULT_KEY]).toEqual({ id: 'p2', ok: true })
  })

  it('stores no result for disconnect and disconnectAll', async () => {
    await started()

    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnect', topic: 'a' }, 'd1') })
    await settleStorage()
    await fake.session.set({ [COMMAND_KEY]: command({ kind: 'disconnectAll' }, 'd2') })
    await settleStorage()

    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
  })

  it('readPairResult returns the stored result', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'x', ok: false }

    expect(await readPairResult()).toEqual({ id: 'x', ok: false })
  })

  it.each([
    ['absent', undefined],
    ['a string', 'junk'],
    ['null', null],
    ['a missing id', { ok: true }],
    ['a numeric id', { id: 1, ok: true }],
    ['a non-boolean ok', { id: 'x', ok: 'yes' }],
  ])('readPairResult returns null for %s', async (_name, value) => {
    if (value !== undefined) fake.session.data[PAIR_RESULT_KEY] = value

    expect(await readPairResult()).toBeNull()
  })

  it('clearPairResult removes the key', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'x', ok: true }

    await clearPairResult()

    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
  })
})

describe('startWalletConnectHostBridge summary meta', () => {
  it('carries verification and approvedAt for a topic with meta and omits them otherwise', async () => {
    metaMock.readSessionMeta.mockResolvedValue({ a: { verification: 'valid', approvedAt: 42 } })
    const { host, resolve } = makeHost({}, [session('a'), session('b')])

    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    const [a, b] = fake.local.data[SUMMARY_KEY] as Record<string, unknown>[]
    expect(a).toMatchObject({ topic: 'a', verification: 'valid', approvedAt: 42 })
    expect(b).not.toHaveProperty('verification')
    expect(b).not.toHaveProperty('approvedAt')
  })

  it('still writes the summary, without meta, when reading the meta throws', async () => {
    metaMock.readSessionMeta.mockRejectedValue(new Error('storage down'))
    const { host, resolve } = makeHost({}, [session('a')])

    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()

    const [a] = fake.local.data[SUMMARY_KEY] as Record<string, unknown>[]
    expect(a).toMatchObject({ topic: 'a' })
    expect(a).not.toHaveProperty('verification')
    expect(console.error).toHaveBeenCalled()
  })

  it('leaves the last session list stored when writes overlap', async () => {
    let slow = true
    metaMock.readSessionMeta.mockImplementation(async () => {
      if (slow) {
        slow = false
        await new Promise((r) => setTimeout(r, 20))
      }
      return {}
    })
    const { host, sessionRef, resolve } = makeHost({}, [session('a')])
    startWalletConnectHostBridge(host)
    resolve()
    await settleStorage()
    sessionRef.value = [session('a'), session('b')]
    sessionRef.value = [session('c')]
    await new Promise((r) => setTimeout(r, 60))
    await settleStorage()

    expect((fake.local.data[SUMMARY_KEY] as { topic: string }[]).map((s) => s.topic)).toEqual(['c'])
  })
})

describe('activeSessions meta fields', () => {
  const now = 1_000_000
  const base = { topic: 't', expiry: 2_000_000_000 }

  it('keeps a well-formed verification and approvedAt', () => {
    expect(
      activeSessions([{ ...base, verification: 'invalid', approvedAt: 9 }], now)[0]
    ).toMatchObject({
      verification: 'invalid',
      approvedAt: 9,
    })
  })

  it.each([
    ['a bad verification string', { verification: 'scam' }, 'verification'],
    ['a string approvedAt', { approvedAt: '9' }, 'approvedAt'],
    ['a zero approvedAt', { approvedAt: 0 }, 'approvedAt'],
    ['an infinite approvedAt', { approvedAt: Infinity }, 'approvedAt'],
  ])('drops %s', (_name, extra, field) => {
    const [result] = activeSessions([{ ...base, ...extra }], now)

    expect(result.topic).toBe('t')
    expect(result).not.toHaveProperty(field)
  })

  it('parses an entry stored without the meta fields', () => {
    const [result] = activeSessions([base], now)

    expect(result).not.toHaveProperty('verification')
    expect(result).not.toHaveProperty('approvedAt')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router } from 'vue-router'

import { SEND_HEARTBEAT_MS, SEND_STALE_MS, SESSION_KEY_PREFIX_SEND } from '@/config'
import { installFakeChrome } from '@/test/fake-chrome'
import type { SendContext } from '../send-recorder'
import type { SendRecord } from '../session-send-recorder'

const mocks = vi.hoisted(() => ({ trackPublished: vi.fn() }))

vi.mock('./useTxTracker', () => ({ trackPublished: mocks.trackPublished }))

const NOW = 1_700_000_000_000
const ACCOUNT = 'z1active'
const context: SendContext = {
  kind: 'send',
  title: 'Send ZNN',
  from: ACCOUNT,
  amount: '100',
  decimals: 8,
  symbol: 'ZNN',
  tokenStandard: 'zts1znn',
  recipient: 'z1to',
}

let env: ReturnType<typeof installFakeChrome>
let sends: typeof import('./useInterruptedSends')
let routeName: string

const router = {
  currentRoute: {
    get value() {
      return { name: routeName }
    },
  },
  replace: vi.fn(),
}

async function pump<T>(call: Promise<T>): Promise<T> {
  const outcome = call.then(
    (value) => ({ value }),
    (error) => ({ error })
  )
  await vi.advanceTimersByTimeAsync(50)
  const result = await outcome
  if ('error' in result) throw result.error
  return result.value
}

const check = (opts: { popupStart: boolean }) =>
  pump(sends.checkInterrupted(router as unknown as Router, opts))

function seed(over: Partial<SendRecord> & { id: string }): SendRecord {
  const record: SendRecord = {
    surface: 'popup',
    stage: 'pow-started',
    context,
    startedAt: NOW,
    heartbeatAt: NOW,
    ...over,
  }
  env.session.data[SESSION_KEY_PREFIX_SEND + record.id] = record
  return record
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  routeName = 'home'
  router.replace.mockReset()
  mocks.trackPublished.mockReset()
  env = installFakeChrome()
  sends = await import('./useInterruptedSends')
  const recorder = await import('../send-recorder')
  const session = await import('../session-send-recorder')
  recorder.setSendRecorder(session.createSessionSendRecorder('popup'))
  sends.configureInterruptedSends(session.sessionInterruptedSource)
  mocks.trackPublished.mockImplementation(async (tx: { hash: string }) => {
    await recorder.getSendRecorder().release(tx.hash)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('checkInterrupted', () => {
  it('reports a popup record with a 2 s old heartbeat at popup start and opens the screen', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value?.id).toBe('p')
    expect(router.replace).toHaveBeenCalledWith({ name: 'interrupted' })
  })

  it('does not report the same record at tab start', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })

    await check({ popupStart: false })

    expect(sends.useInterruptedSends().current.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does not report a fresh tab record at start, and a 5 s re-run reports it once it is over 15 s old', async () => {
    seed({ id: 't', surface: 'tab', heartbeatAt: NOW })
    const stop = sends.startInterruptedChecks(router as unknown as Router, { popupStart: false })

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 3)
    expect(sends.useInterruptedSends().current.value).toBeNull()

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 2)
    stop()

    expect(Date.now() - NOW).toBeGreaterThan(SEND_STALE_MS)
    expect(sends.useInterruptedSends().current.value?.id).toBe('t')
    expect(router.replace).toHaveBeenCalledWith({ name: 'interrupted' })
  })

  it('does not navigate off home on a re-run, and navigates on the next run on home', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })
    routeName = 'send'

    await check({ popupStart: true })
    expect(sends.useInterruptedSends().current.value?.id).toBe('p')
    expect(router.replace).not.toHaveBeenCalled()

    routeName = 'home'
    await check({ popupStart: false })

    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(router.replace).toHaveBeenCalledWith({ name: 'interrupted' })
  })

  it('does not navigate on the next home re-run after dismiss', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })
    routeName = 'send'
    await check({ popupStart: true })
    const { dismiss, current } = sends.useInterruptedSends()

    await pump(dismiss('p'))
    expect(current.value).toBeNull()
    expect(env.session.data[SESSION_KEY_PREFIX_SEND + 'p']).toBeUndefined()

    routeName = 'home'
    await check({ popupStart: false })

    expect(router.replace).not.toHaveBeenCalled()
  })

  it('does not navigate off a non-home page on the first run, and navigates on the next home run', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })
    routeName = 'send'
    const stop = sends.startInterruptedChecks(router as unknown as Router, { popupStart: true })

    await vi.advanceTimersByTimeAsync(100)
    expect(router.replace).not.toHaveBeenCalled()

    routeName = 'home'
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS + 100)
    stop()

    expect(router.replace).toHaveBeenCalledWith({ name: 'interrupted' })
  })

  it('does not list a record whose sending document is alive', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000, documentId: 'doc-1' })
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'doc-1', frameId: 0 }])

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('lists a record without proof the sender is gone as unproven', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value?.senderGone).toBe(false)
  })

  it('does not navigate again when already on the interrupted screen', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })
    routeName = 'interrupted'

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value?.id).toBe('p')
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('hands a published record to trackPublished with its publishedAt and does not track it again', async () => {
    seed({
      id: 'pub',
      surface: 'popup',
      stage: 'published',
      hash: 'h1',
      publishedAt: NOW - 3000,
      heartbeatAt: NOW - 1000,
    })

    await check({ popupStart: true })

    expect(mocks.trackPublished).toHaveBeenCalledTimes(1)
    const [tracked] = mocks.trackPublished.mock.calls[0]
    expect(tracked).toMatchObject({
      hash: 'h1',
      label: 'Send ZNN',
      address: ACCOUNT,
      publishedAt: NOW - 3000,
    })
    expect(tracked.meta).not.toHaveProperty('from')
    expect(tracked.meta).toMatchObject({ kind: 'send', recipient: 'z1to', amount: '100' })
    expect(router.replace).not.toHaveBeenCalled()

    await check({ popupStart: true })

    expect(mocks.trackPublished).toHaveBeenCalledTimes(1)
  })

  it('keeps an interrupted record listed after a later run that no longer sees it as stale', async () => {
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 2000 })
    routeName = 'send'
    await check({ popupStart: true })

    await check({ popupStart: false })

    expect(sends.useInterruptedSends().current.value?.id).toBe('p')
  })

  it('lists several interrupted sends oldest first', async () => {
    seed({ id: 'late', surface: 'popup', startedAt: NOW - 10 })
    seed({ id: 'early', surface: 'popup', startedAt: NOW - 500 })
    routeName = 'send'

    await check({ popupStart: true })
    const { current, dismiss } = sends.useInterruptedSends()
    expect(current.value?.id).toBe('early')

    await pump(dismiss('early'))
    expect(current.value?.id).toBe('late')
  })
})

describe('checkInterrupted for background records', () => {
  const background: SendContext = {
    ...context,
    kind: 'receive',
    title: 'Auto-receive 1 ZNN',
    background: true,
  }
  const stored = (id: string) => env.session.data[SESSION_KEY_PREFIX_SEND + id]

  it('removes an unpublished record silently and does not open the screen', async () => {
    seed({ id: 'bg', surface: 'popup', context: background, heartbeatAt: NOW - 2000 })

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
    expect(mocks.trackPublished).not.toHaveBeenCalled()
    expect(stored('bg')).toBeUndefined()
  })

  it('tracks a published record and does not list it', async () => {
    seed({
      id: 'bgpub',
      surface: 'popup',
      stage: 'published',
      hash: 'h9',
      context: background,
      publishedAt: NOW - 3000,
      heartbeatAt: NOW - 1000,
    })

    await check({ popupStart: true })

    expect(mocks.trackPublished).toHaveBeenCalledTimes(1)
    expect(mocks.trackPublished.mock.calls[0][0]).toMatchObject({ hash: 'h9' })
    expect(sends.useInterruptedSends().current.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('still lists a foreground record next to a background one', async () => {
    seed({ id: 'bg', surface: 'popup', context: background, heartbeatAt: NOW - 2000 })
    seed({ id: 'fg', surface: 'popup', heartbeatAt: NOW - 2000 })

    await check({ popupStart: true })

    expect(sends.useInterruptedSends().current.value?.id).toBe('fg')
    expect(stored('bg')).toBeUndefined()
    expect(stored('fg')).toBeDefined()
  })

  it('logs a failed removal and keeps checking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { sessionInterruptedSource } = await import('../session-send-recorder')
    sends.configureInterruptedSends({
      ...sessionInterruptedSource,
      remove: async () => {
        throw new Error('quota')
      },
    })
    seed({ id: 'bg', surface: 'popup', context: background, heartbeatAt: NOW - 2000 })

    await check({ popupStart: true })

    expect(warn).toHaveBeenCalledWith('Could not remove send record', expect.any(Error))
    expect(sends.useInterruptedSends().current.value).toBeNull()
  })
})

describe('startInterruptedChecks', () => {
  it('logs a failed check and keeps running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(env.session, 'get').mockRejectedValueOnce(new Error('gone'))

    const stop = sends.startInterruptedChecks(router as unknown as Router, { popupStart: true })
    await vi.advanceTimersByTimeAsync(50)
    expect(warn).toHaveBeenCalledWith('Interrupted send check failed', expect.any(Error))

    seed({ id: 'p', surface: 'tab', heartbeatAt: NOW - 20_000 })
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS + 50)
    stop()

    expect(sends.useInterruptedSends().current.value?.id).toBe('p')
  })

  it('stops checking once the returned function is called', async () => {
    const get = vi.spyOn(env.session, 'get')
    const stop = sends.startInterruptedChecks(router as unknown as Router, { popupStart: false })
    await vi.advanceTimersByTimeAsync(50)
    const calls = get.mock.calls.length

    stop()
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 4)

    expect(get.mock.calls.length).toBe(calls)
  })
})

describe('retryTarget', () => {
  const record = (over: Partial<SendContext> = {}): SendRecord => ({
    id: 'r',
    surface: 'popup',
    stage: 'pow-started',
    context: { ...context, ...over },
    startedAt: NOW,
    heartbeatAt: NOW,
  })
  const target = (r: SendRecord, address: string | null = ACCOUNT) =>
    sends.useInterruptedSends().retryTarget(r, address)

  it('is send-review for a complete send of the active account', () => {
    expect(target(record())).toBe('send-review')
  })

  it('is receive for a receive of the active account', () => {
    expect(target(record({ kind: 'receive' }))).toBe('receive')
  })

  it('is null for another account or no active account', () => {
    expect(target(record(), 'z1other')).toBeNull()
    expect(target(record(), null)).toBeNull()
  })

  it('is null for a dApp origin', () => {
    expect(target(record({ origin: 'https://dapp.example' }))).toBeNull()
  })

  it('is null for a detached record', () => {
    expect(target({ ...record(), stage: 'publishing', detached: true })).toBeNull()
  })

  it('is null for a contract call', () => {
    expect(target(record({ kind: 'contract' }))).toBeNull()
  })

  it.each(['recipient', 'amount', 'decimals', 'symbol', 'tokenStandard'] as const)(
    'is null for a send missing %s',
    (field) => {
      expect(target(record({ [field]: undefined }))).toBeNull()
    }
  )
})

describe('configureInterruptedSends', () => {
  it('finds nothing and does not navigate when no source is configured', async () => {
    vi.resetModules()
    const fresh = await import('./useInterruptedSends')
    seed({ id: 'p', surface: 'popup', heartbeatAt: NOW - 20_000 })

    await check2(fresh, { popupStart: true })

    expect(fresh.useInterruptedSends().current.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('lists and removes through the configured source', async () => {
    const record = { ...seed({ id: 'x' }), senderGone: true }
    const source = {
      list: vi.fn().mockResolvedValue([record]),
      remove: vi.fn().mockResolvedValue(undefined),
      take: vi.fn().mockResolvedValue(true),
    }
    sends.configureInterruptedSends(source)

    await check({ popupStart: false })
    expect(source.list).toHaveBeenCalledTimes(1)
    expect(sends.useInterruptedSends().current.value?.id).toBe('x')

    await pump(sends.useInterruptedSends().dismiss('x'))

    expect(source.remove).toHaveBeenCalledWith('x')
    expect(sends.useInterruptedSends().current.value).toBeNull()
  })

  it('claims a record only while the source still holds it', async () => {
    const record = { ...seed({ id: 'x' }), senderGone: true }
    const source = {
      list: vi.fn().mockResolvedValue([record]),
      remove: vi.fn().mockResolvedValue(undefined),
      take: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    }
    sends.configureInterruptedSends(source)
    await check({ popupStart: false })
    const controls = sends.useInterruptedSends()

    expect(await controls.claim(record)).toBe(true)
    expect(source.take).toHaveBeenCalledWith('x', record.stage)
    expect(controls.current.value).toBeNull()
    expect(await controls.claim(record)).toBe(false)
  })
})

function check2(mod: typeof import('./useInterruptedSends'), opts: { popupStart: boolean }) {
  return pump(mod.checkInterrupted(router as unknown as Router, opts))
}

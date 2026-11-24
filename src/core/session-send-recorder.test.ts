import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SEND_HEARTBEAT_MS, SEND_STALE_MS, SESSION_KEY_PREFIX_SEND } from '@/config'
import { installFakeChrome } from '@/test/fake-chrome'
import type { SendContext } from './send-recorder'
import type { SendRecord } from './session-send-recorder'

const NOW = 1_700_000_000_000
const context: SendContext = { kind: 'send', title: 'Send ZNN', from: 'z1from' }

let env: ReturnType<typeof installFakeChrome>
let mod: typeof import('./session-send-recorder')

const settle = () => vi.advanceTimersByTimeAsync(10)
// Every fake storage call waits on a timer, so a bare await would hang under fake timers.
async function pump<T>(call: Promise<T>): Promise<T> {
  const outcome = call.then(
    (value) => ({ value }),
    (error) => ({ error })
  )
  await vi.advanceTimersByTimeAsync(20)
  const result = await outcome
  if ('error' in result) throw result.error
  return result.value
}
const records = () =>
  Object.entries(env.session.data)
    .filter(([key]) => key.startsWith(SESSION_KEY_PREFIX_SEND))
    .map(([, value]) => value as SendRecord)

// A record written by another document: this module instance never saw it begin.
function seed(over: Partial<SendRecord> & { id: string }): SendRecord {
  const record: SendRecord = {
    surface: 'tab',
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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  env = installFakeChrome()
  mod = await import('./session-send-recorder')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createSessionSendRecorder', () => {
  it('begin writes one record with the surface and the pow-started stage', async () => {
    mod.createSessionSendRecorder('popup').begin(context)
    await settle()

    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({ surface: 'popup', stage: 'pow-started', context })
  })

  it('rewrites heartbeatAt every SEND_HEARTBEAT_MS', async () => {
    mod.createSessionSendRecorder('tab').begin(context)
    await settle()
    expect(records()[0].heartbeatAt).toBe(NOW)

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS)
    expect(records()[0].heartbeatAt).toBe(NOW + SEND_HEARTBEAT_MS)

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS)
    expect(records()[0].heartbeatAt).toBe(NOW + 2 * SEND_HEARTBEAT_MS)
  })

  it('publishing records the hash and stage', async () => {
    const recording = mod.createSessionSendRecorder('tab').begin(context)
    recording.publishing('h1')
    await settle()

    expect(records()[0]).toMatchObject({ stage: 'publishing', hash: 'h1' })
  })

  it('release removes the record and stops the heartbeat', async () => {
    const recorder = mod.createSessionSendRecorder('tab')
    const recording = recorder.begin(context)
    recording.publishing('h1')
    await settle()

    await pump(recorder.release('h1'))
    expect(records()).toEqual([])

    await vi.advanceTimersByTimeAsync(3 * SEND_HEARTBEAT_MS)
    expect(records()).toEqual([])
  })

  it('abandon removes the record and stops the heartbeat', async () => {
    const recording = mod.createSessionSendRecorder('tab').begin(context)
    await settle()
    expect(records()).toHaveLength(1)

    recording.abandon()
    await settle()
    expect(records()).toEqual([])

    await vi.advanceTimersByTimeAsync(3 * SEND_HEARTBEAT_MS)
    expect(records()).toEqual([])
  })

  it("a second recorder instance's release removes the first one's record and keeps other hashes", async () => {
    const first = mod.createSessionSendRecorder('tab')
    first.begin(context).publishing('h1')
    first.begin(context).publishing('h2')
    await settle()
    expect(records()).toHaveLength(2)

    await pump(mod.createSessionSendRecorder('tab').release('h1'))

    expect(records().map((r) => r.hash)).toEqual(['h2'])
  })

  it('release stops the heartbeat registered by another recorder instance', async () => {
    mod.createSessionSendRecorder('tab').begin(context).publishing('h1')
    await settle()

    await pump(mod.createSessionSendRecorder('tab').release('h1'))
    await vi.advanceTimersByTimeAsync(3 * SEND_HEARTBEAT_MS)

    expect(records()).toEqual([])
  })

  it('after abandon, publishing writes nothing and published writes one record without a heartbeat', async () => {
    const recording = mod.createSessionSendRecorder('tab').begin(context)
    await settle()
    recording.abandon()
    await settle()

    recording.publishing('h1')
    await settle()
    expect(records()).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    recording.published('h1')
    await settle()
    const written = records()
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ stage: 'published', hash: 'h1' })
    expect(written[0].publishedAt).toBeGreaterThanOrEqual(NOW + 1000)

    await vi.advanceTimersByTimeAsync(3 * SEND_HEARTBEAT_MS)
    expect(records()[0].heartbeatAt).toBe(written[0].heartbeatAt)
  })

  it('detach keeps a late-published record that the stale check lists, and release clears it', async () => {
    const recorder = mod.createSessionSendRecorder('tab')
    const recording = recorder.begin(context)
    await settle()
    recording.publishing('h1')
    recording.detach()
    recording.published('h1')
    await vi.advanceTimersByTimeAsync(SEND_STALE_MS + SEND_HEARTBEAT_MS)

    const listed = await pump(mod.listInterrupted(Date.now(), { popupStart: false }))
    expect(listed.map((r) => [r.stage, r.hash])).toEqual([['published', 'h1']])

    await pump(recorder.release('h1'))
    expect(records()).toEqual([])
  })

  it('lists a detached record as may have been sent while its sender document is alive', async () => {
    env.contexts.push({ documentId: 'live-doc', frameId: 0 })
    seed({
      id: 'detached',
      documentId: 'live-doc',
      stage: 'publishing',
      hash: 'h1',
      detached: true,
    })
    seed({ id: 'plain', documentId: 'live-doc', stage: 'publishing', hash: 'h2' })
    await vi.advanceTimersByTimeAsync(SEND_STALE_MS + SEND_HEARTBEAT_MS)

    const listed = await pump(mod.listInterrupted(Date.now(), { popupStart: false }))
    expect(listed.map((r) => r.id)).toEqual(['detached'])
  })

  it('detach stops the heartbeat and keeps the record at publishing with its hash', async () => {
    const recording = mod.createSessionSendRecorder('tab').begin(context)
    await settle()
    recording.publishing('h1')
    recording.detach()
    await settle()
    const [before] = records()

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 4)

    const [after] = records()
    expect(after).toMatchObject({ stage: 'publishing', hash: 'h1', detached: true })
    expect(after.heartbeatAt).toBe(before.heartbeatAt)
  })

  it('keeps the heartbeat running after published until release', async () => {
    const recorder = mod.createSessionSendRecorder('tab')
    const recording = recorder.begin(context)
    recording.published('h1')
    await settle()

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS)
    expect(records()[0].heartbeatAt).toBeGreaterThan(records()[0].publishedAt as number)

    await pump(recorder.release('h1'))
    expect(records()).toEqual([])
  })

  it('release of a hash with no record resolves', async () => {
    await expect(
      pump(mod.createSessionSendRecorder('tab').release('missing'))
    ).resolves.toBeUndefined()
  })

  it('logs and carries on when a storage write fails', async () => {
    vi.spyOn(env.session, 'set').mockRejectedValue(new Error('quota'))

    expect(() => mod.createSessionSendRecorder('tab').begin(context)).not.toThrow()
    await settle()

    expect(console.warn).toHaveBeenCalled()
  })
})

describe('listInterrupted', () => {
  const later = (ms: number) => NOW + ms

  it('returns only records stale by more than SEND_STALE_MS, oldest first', async () => {
    seed({ id: 'newer', startedAt: NOW - 1000, heartbeatAt: NOW - SEND_STALE_MS - 1 })
    seed({ id: 'older', startedAt: NOW - 2000, heartbeatAt: NOW - SEND_STALE_MS - 5 })
    seed({ id: 'edge', heartbeatAt: NOW - SEND_STALE_MS })
    seed({ id: 'fresh', heartbeatAt: NOW - 1000 })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.id)).toEqual(['older', 'newer'])
  })

  it('adds fresh popup records at popup start and no fresh tab, window or approval record', async () => {
    seed({ id: 'popup', surface: 'popup', heartbeatAt: NOW - 2000 })
    seed({ id: 'tab', surface: 'tab', heartbeatAt: NOW - 2000 })
    seed({ id: 'window', surface: 'window', heartbeatAt: NOW - 2000 })
    seed({ id: 'approval', surface: 'approval', heartbeatAt: NOW - 2000 })

    const atStart = await pump(mod.listInterrupted(NOW, { popupStart: true }))
    const notStart = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(atStart.map((r) => r.id)).toEqual(['popup'])
    expect(notStart).toEqual([])
  })

  it('adds a fresh record by id through keep', async () => {
    seed({ id: 'kept', surface: 'tab', heartbeatAt: NOW - 1000 })
    seed({ id: 'other', surface: 'tab', heartbeatAt: NOW - 1000 })

    const found = await pump(
      mod.listInterrupted(NOW, { popupStart: false, keep: new Set(['kept']) })
    )

    expect(found.map((r) => r.id)).toEqual(['kept'])
  })

  it("skips this document's own in-progress records even when stale", async () => {
    const recording = mod.createSessionSendRecorder('popup').begin(context)
    recording.publishing('h1')
    await settle()

    const found = await pump(mod.listInterrupted(later(10 * SEND_STALE_MS), { popupStart: true }))

    expect(found).toEqual([])
  })

  it('reports a record of another document that has the same surface', async () => {
    mod.createSessionSendRecorder('popup').begin(context)
    await settle()

    vi.resetModules()
    const otherDocument = await import('./session-send-recorder')
    const found = await pump(otherDocument.listInterrupted(NOW, { popupStart: true }))

    expect(found).toHaveLength(1)
  })

  it('skips an own published record, and release removes it', async () => {
    const recorder = mod.createSessionSendRecorder('popup')
    recorder.begin(context).published('h1')
    await settle()
    expect(await pump(mod.listInterrupted(NOW, { popupStart: true }))).toEqual([])

    await pump(recorder.release('h1'))

    expect(records()).toEqual([])
  })

  it('skips malformed values and keys outside the send prefix', async () => {
    const stale = NOW - 10 * SEND_STALE_MS
    env.session.data[SESSION_KEY_PREFIX_SEND + 'bad1'] = 'text'
    env.session.data[SESSION_KEY_PREFIX_SEND + 'bad2'] = null
    env.session.data[SESSION_KEY_PREFIX_SEND + 'bad3'] = {
      id: 'bad3',
      surface: 'tab',
      stage: 'nope',
      context,
      startedAt: 1,
      heartbeatAt: stale,
    }
    env.session.data[SESSION_KEY_PREFIX_SEND + 'bad4'] = {
      id: 'bad4',
      surface: 'tab',
      stage: 'published',
      context,
      startedAt: 1,
      heartbeatAt: stale,
    }
    env.session.data[SESSION_KEY_PREFIX_SEND + 'bad5'] = {
      id: 'bad5',
      surface: 'tab',
      stage: 'pow-started',
      context: null,
      startedAt: 1,
      heartbeatAt: stale,
    }
    env.session.data['other:key'] = { id: 'x' }
    seed({ id: 'good', heartbeatAt: stale })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.id)).toEqual(['good'])
  })
})

describe('classify', () => {
  const base = seed

  it('tracks a published record by hash', () => {
    const record = base({ id: 'a', stage: 'published', hash: 'h1' })
    expect(mod.classify(record)).toEqual({ kind: 'track', hash: 'h1' })
  })

  it('treats a publishing record as maybe sent', () => {
    expect(mod.classify(base({ id: 'b', stage: 'publishing', hash: 'h1' }))).toEqual({
      kind: 'maybeSent',
    })
  })

  it('treats a publishing record as maybe sent even when the sender is proven gone', () => {
    const record = base({ id: 'd', stage: 'publishing', hash: 'h1' })
    expect(mod.classify({ ...record, senderGone: true })).toEqual({ kind: 'maybeSent' })
  })

  it('treats a pow-started record as not sent only when the sender is proven gone', () => {
    const record = base({ id: 'c', stage: 'pow-started' })
    expect(mod.classify({ ...record, senderGone: true })).toEqual({ kind: 'notSent' })
  })

  it('treats a pow-started record with an unproven sender as maybe sent', () => {
    const record = base({ id: 'c', stage: 'pow-started' })
    expect(mod.classify(record)).toEqual({ kind: 'maybeSent' })
    expect(mod.classify({ ...record, senderGone: false })).toEqual({ kind: 'maybeSent' })
  })
})

describe('removeSendRecord', () => {
  it('removes the record by id', async () => {
    seed({ id: 'a' })
    seed({ id: 'b' })

    await pump(mod.removeSendRecord('a'))

    expect(records().map((r) => r.id)).toEqual(['b'])
  })

  it('resolves for a missing id', async () => {
    await expect(pump(mod.removeSendRecord('missing'))).resolves.toBeUndefined()
  })
})

describe('sender liveness', () => {
  const stale = { heartbeatAt: NOW - 20_000, documentId: 'doc-1' }

  it('drops a record whose sending document is still alive', async () => {
    seed({ id: 'a', ...stale })
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'doc-1', frameId: 0 }])

    expect(await pump(mod.listInterrupted(NOW, { popupStart: true }))).toEqual([])
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({ documentIds: ['doc-1'] })
  })

  it('marks a record whose sending document is gone', async () => {
    seed({ id: 'a', ...stale })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => [r.id, r.senderGone])).toEqual([['a', true]])
  })

  it('does not prove a sender gone without a document id', async () => {
    seed({ id: 'a', heartbeatAt: NOW - 20_000 })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.senderGone)).toEqual([false])
  })

  it('does not prove a sender gone when the contexts lookup fails', async () => {
    seed({ id: 'a', ...stale })
    env.chrome.runtime.getContexts.mockRejectedValue(new Error('unsupported'))

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.senderGone)).toEqual([false])
  })

  it('stores the popup document id on a new record', async () => {
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'popup-doc', frameId: 0 }])
    mod.createSessionSendRecorder('popup').begin(context)
    await settle()

    expect(records()[0].documentId).toBe('popup-doc')
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['POPUP'] })
  })

  it('stores the tab document id when the document is a tab', async () => {
    env.chrome.tabs.getCurrent.mockResolvedValue({ id: 7 })
    env.chrome.runtime.getContexts.mockResolvedValue([
      { documentId: 'sandbox', frameId: 3 },
      { documentId: 'tab-doc', frameId: 0 },
    ])
    mod.createSessionSendRecorder('tab').begin(context)
    await settle()

    expect(records()[0].documentId).toBe('tab-doc')
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({
      tabIds: [7],
      contextTypes: ['TAB'],
    })
  })

  it('records no document id when more than one top-level context matches', async () => {
    env.chrome.runtime.getContexts.mockResolvedValue([
      { documentId: 'popup-a', frameId: 0 },
      { documentId: 'popup-b', frameId: 0 },
    ])
    mod.createSessionSendRecorder('popup').begin(context)
    await settle()

    expect(records()[0].documentId).toBeUndefined()
  })

  it('stores the side panel document id found by the document token', async () => {
    vi.stubGlobal('location', { search: '?panel=tok-1' })
    env.chrome.runtime.getContexts.mockResolvedValue([
      {
        documentId: 'other-doc',
        frameId: 0,
        documentUrl: 'chrome-extension://w/sidepanel.html?panel=tok-2#/',
      },
      {
        documentId: 'panel-doc',
        frameId: 0,
        documentUrl: 'chrome-extension://w/sidepanel.html?panel=tok-1#/send',
      },
    ])
    mod.createSessionSendRecorder('sidepanel').begin(context)
    await settle()

    expect(records()[0].documentId).toBe('panel-doc')
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] })
    expect(env.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('looks up a sidepanel recorder in a tab as a tab', async () => {
    env.chrome.tabs.getCurrent.mockResolvedValue({ id: 77 })
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'tab-doc', frameId: 0 }])
    mod.createSessionSendRecorder('sidepanel').begin(context)
    await settle()

    expect(records()[0].documentId).toBe('tab-doc')
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({
      tabIds: [77],
      contextTypes: ['TAB'],
    })
  })

  it.each([
    [
      'no token in the url',
      '',
      [{ documentId: 'panel-doc', frameId: 0, documentUrl: 'chrome-extension://w/sidepanel.html' }],
    ],
    [
      'no context with the token',
      '?panel=tok-1',
      [
        {
          documentId: 'a',
          frameId: 0,
          documentUrl: 'chrome-extension://w/sidepanel.html?panel=tok-2',
        },
      ],
    ],
    [
      'two contexts with the token',
      '?panel=tok-1',
      [
        {
          documentId: 'a',
          frameId: 0,
          documentUrl: 'chrome-extension://w/sidepanel.html?panel=tok-1',
        },
        {
          documentId: 'b',
          frameId: 0,
          documentUrl: 'chrome-extension://w/sidepanel.html?panel=tok-1',
        },
      ],
    ],
  ])('records no side panel document id for %s', async (_name, search, contexts) => {
    vi.stubGlobal('location', { search })
    env.chrome.runtime.getContexts.mockResolvedValue(contexts)
    mod.createSessionSendRecorder('sidepanel').begin(context)
    await settle()

    expect(records()[0].documentId).toBeUndefined()
  })

  it('records no side panel document id when the context lookup fails', async () => {
    vi.stubGlobal('location', { search: '?panel=tok-1' })
    env.chrome.runtime.getContexts.mockRejectedValue(new Error('unavailable'))
    mod.createSessionSendRecorder('sidepanel').begin(context)
    await settle()

    expect(records()[0].documentId).toBeUndefined()
  })

  it('never says not sent for a stale side panel record with no document id', async () => {
    seed({ id: 'a', surface: 'sidepanel', heartbeatAt: NOW - 20_000 })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found).toHaveLength(1)
    expect(found[0].senderGone).toBe(false)
    expect(mod.classify(found[0])).toEqual({ kind: 'maybeSent' })
  })

  it('says not sent for a stale side panel record whose panel is gone', async () => {
    seed({ id: 'a', surface: 'sidepanel', heartbeatAt: NOW - 20_000, documentId: 'panel-doc' })

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.senderGone)).toEqual([true])
  })

  it('drops a stale side panel record whose panel is still alive', async () => {
    seed({ id: 'a', surface: 'sidepanel', heartbeatAt: NOW - 20_000, documentId: 'panel-doc' })
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'panel-doc', frameId: 0 }])

    expect(await pump(mod.listInterrupted(NOW, { popupStart: false }))).toEqual([])
    expect(env.chrome.runtime.getContexts).toHaveBeenCalledWith({ documentIds: ['panel-doc'] })
  })

  it('does not mark a fresh side panel record dead at popup start', async () => {
    seed({ id: 'a', surface: 'sidepanel', heartbeatAt: NOW, documentId: 'panel-doc' })

    expect(await pump(mod.listInterrupted(NOW, { popupStart: true }))).toEqual([])
    expect(env.chrome.runtime.getContexts).not.toHaveBeenCalled()
  })

  it('lists a published record whose sending document is still alive', async () => {
    seed({
      id: 'a',
      stage: 'published',
      hash: 'h1',
      heartbeatAt: NOW - 20_000,
      documentId: 'doc-1',
    })
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'doc-1', frameId: 0 }])

    const found = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(found.map((r) => r.id)).toEqual(['a'])
  })

  it('does not rewrite a record that was abandoned before the id resolved', async () => {
    env.chrome.runtime.getContexts.mockResolvedValue([{ documentId: 'popup-doc', frameId: 0 }])
    const recording = mod.createSessionSendRecorder('popup').begin(context)
    recording.abandon()
    await settle()
    await settle()

    expect(records()).toEqual([])
  })
})

describe('sessionInterruptedSource', () => {
  it('lists as listInterrupted does', async () => {
    seed({ id: 'old', heartbeatAt: NOW - 60_000 })
    seed({ id: 'fresh' })

    const viaSource = await pump(mod.sessionInterruptedSource.list(NOW, { popupStart: false }))
    const direct = await pump(mod.listInterrupted(NOW, { popupStart: false }))

    expect(viaSource.map((r) => r.id)).toEqual(['old'])
    expect(viaSource).toEqual(direct)
  })

  it('removes as removeSendRecord does', async () => {
    seed({ id: 'a' })
    seed({ id: 'b' })

    await pump(mod.sessionInterruptedSource.remove('a'))

    expect(records().map((r) => r.id)).toEqual(['b'])
  })
})

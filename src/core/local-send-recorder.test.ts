import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SEND_HEARTBEAT_MS, SEND_STALE_MS, WEB_TAB_LOCK_PREFIX } from '@/config'
import { installFakeLocks } from '@/test/fake-web'
import type { FakeLocks } from '@/test/fake-web'
import { classify } from './send-record'
import type { SendRecord } from './send-record'
import type { SendContext } from './send-recorder'
import { createMemorySendRecordStore } from './storage/send-record-store'
import type { SendRecordStore } from './storage/send-record-store'

const NOW = 1_700_000_000_000
const context: SendContext = { kind: 'send', title: 'Send ZNN', from: 'z1from' }

type Mod = typeof import('./local-send-recorder')

let locks: FakeLocks
let store: SendRecordStore
let mod: Mod

async function freshModule(): Promise<Mod> {
  vi.resetModules()
  return import('./local-send-recorder')
}

const all = async () => (await store.list()) as SendRecord[]

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  locks = installFakeLocks()
  store = createMemorySendRecordStore()
  mod = await freshModule()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('startTabLock', () => {
  it('resolves only after the lock callback runs', async () => {
    let resolved = false
    const started = mod.startTabLock().then(() => {
      resolved = true
    })
    expect(locks.held()).toHaveLength(1)
    expect(locks.held()[0].startsWith(WEB_TAB_LOCK_PREFIX)).toBe(true)
    expect(resolved).toBe(false)

    await started
    expect(resolved).toBe(true)
  })

  it('resolves when navigator.locks is missing', async () => {
    vi.stubGlobal('navigator', {})
    await expect(mod.startTabLock()).resolves.toBeUndefined()
  })

  it('resolves with a warning when the request rejects', async () => {
    vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new Error('denied')) } })

    await expect(mod.startTabLock()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })

  it('resolves with a warning when the request throws', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: () => {
          throw new Error('insecure context')
        },
      },
    })

    await expect(mod.startTabLock()).resolves.toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('startTabLock without crypto.randomUUID', () => {
  it('resolves and records no sender id', async () => {
    vi.stubGlobal('crypto', {})

    await expect(mod.startTabLock()).resolves.toBeUndefined()
    expect(locks.held()).toHaveLength(0)

    vi.unstubAllGlobals()
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    expect((await all())[0].documentId).toBeUndefined()
  })
})

describe('tab lock after a page cache restore', () => {
  it('records no sender id while suspended', async () => {
    await mod.startTabLock()
    mod.suspendTabLock()

    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)

    expect((await all())[0].documentId).toBeUndefined()
  })

  it('takes the lock again on resume when the browser released it', async () => {
    await mod.startTabLock()
    const [name] = locks.held()
    mod.suspendTabLock()
    locks.release(name)

    await mod.resumeTabLock()

    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    expect(locks.held()).toContain(name)
    expect(WEB_TAB_LOCK_PREFIX + (await all())[0].documentId).toBe(name)
  })

  it('trusts the lock on resume when it is still held', async () => {
    await mod.startTabLock()
    mod.suspendTabLock()

    await mod.resumeTabLock()

    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    expect((await all())[0].documentId).toBeDefined()
    expect(locks.held()).toHaveLength(1)
  })
})

describe('removeSendRecordsFrom', () => {
  it('deletes the records of the given accounts only', async () => {
    const rec = mod.createLocalSendRecorder(store)
    rec.begin({ ...context, from: 'z1gone' })
    rec.begin({ ...context, from: 'z1kept' })
    await vi.advanceTimersByTimeAsync(0)

    await mod.removeSendRecordsFrom(new Set(['z1gone']))

    expect((await all()).map((r) => r.context.from)).toEqual(['z1kept'])
  })
})

describe('localInterruptedSource.take', () => {
  it('lets one caller take a record at its stage', async () => {
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    const [record] = await all()

    expect(await mod.localInterruptedSource.take(record.id, 'publishing')).toBe(false)
    expect(await mod.localInterruptedSource.take(record.id, 'pow-started')).toBe(true)
    expect(await mod.localInterruptedSource.take(record.id, 'pow-started')).toBe(false)
    expect(await all()).toHaveLength(0)
  })
})

describe('createLocalSendRecorder', () => {
  it('begin writes a web record carrying this tab lock id', async () => {
    await mod.startTabLock()
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)

    const [record] = await all()
    expect(record.surface).toBe('web')
    expect(record.stage).toBe('pow-started')
    expect(WEB_TAB_LOCK_PREFIX + record.documentId).toBe(locks.held()[0])
  })

  it('writes no documentId when the lock request failed', async () => {
    vi.stubGlobal('navigator', { locks: { request: () => Promise.reject(new Error('denied')) } })
    await mod.startTabLock()

    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)

    const [record] = await all()
    expect(record.documentId).toBeUndefined()
  })

  it('writes no documentId when the lock was never requested', async () => {
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)

    expect((await all())[0].documentId).toBeUndefined()
  })

  it('rewrites heartbeatAt every SEND_HEARTBEAT_MS', async () => {
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    const started = (await all())[0].heartbeatAt

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS)

    expect((await all())[0].heartbeatAt).toBe(started + SEND_HEARTBEAT_MS)
  })

  it('writes begin and heartbeat non-durably', async () => {
    const put = vi.spyOn(store, 'put')
    mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS)

    expect(put).toHaveBeenCalledTimes(2)
    for (const call of put.mock.calls) expect(call[1]).toEqual({ durable: false })
  })

  it('keeps publishing pending until the durable put resolves', async () => {
    let finish!: () => void
    const put = vi
      .spyOn(store, 'put')
      .mockImplementation((_r, options) =>
        options.durable ? new Promise<void>((res) => (finish = res)) : Promise.resolve()
      )
    const recording = mod.createLocalSendRecorder(store).begin(context)
    let settled = false
    void Promise.resolve(recording.publishing('h1')).then(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    expect(put).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'publishing', hash: 'h1' }),
      { durable: true }
    )

    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
  })

  it('rejects publishing with the save message when the durable put rejects', async () => {
    vi.spyOn(store, 'put').mockImplementation((_r, options) =>
      options.durable ? Promise.reject(new Error('quota')) : Promise.resolve()
    )
    const recording = mod.createLocalSendRecorder(store).begin(context)

    await expect(recording.publishing('h1')).rejects.toThrow(
      'The wallet could not save this send before publishing, so it was not published.'
    )
  })

  it('writes nothing for publishing after abandon', async () => {
    const recording = mod.createLocalSendRecorder(store).begin(context)
    recording.abandon()
    await vi.advanceTimersByTimeAsync(0)
    const put = vi.spyOn(store, 'put')

    await recording.publishing('h1')

    expect(put).not.toHaveBeenCalled()
    expect(await all()).toEqual([])
  })

  it('abandon removes the record and stops the heartbeat', async () => {
    const recording = mod.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    expect(await all()).toHaveLength(1)

    recording.abandon()
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 3)

    expect(await all()).toEqual([])
  })

  it('release removes the record that carries the hash and stops its heartbeat', async () => {
    const recorder = mod.createLocalSendRecorder(store)
    const recording = recorder.begin(context)
    await recording.publishing('h1')
    recording.published('h1')
    recorder.begin(context)
    await vi.advanceTimersByTimeAsync(0)
    expect(await all()).toHaveLength(2)

    await recorder.release('h1')

    const left = await all()
    expect(left).toHaveLength(1)
    expect(left[0].hash).toBeUndefined()
    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 2)
    expect((await all()).map((r) => r.hash)).not.toContain('h1')
  })

  it('records published with the hash', async () => {
    const recording = mod.createLocalSendRecorder(store).begin(context)
    await recording.publishing('h1')
    recording.published('h1')
    await vi.advanceTimersByTimeAsync(0)

    expect((await all())[0]).toMatchObject({ stage: 'published', hash: 'h1' })
  })
})

describe('detach', () => {
  it('keeps a late-published record, which another listing then tracks and release clears', async () => {
    const recorder = mod.createLocalSendRecorder(store)
    const recording = recorder.begin(context)
    await recording.publishing('h1')
    recording.detach()
    recording.published('h1')
    await vi.advanceTimersByTimeAsync(SEND_STALE_MS + SEND_HEARTBEAT_MS)

    const listed = await mod.localInterruptedSource.list(Date.now(), { popupStart: false })
    expect(listed.map((r) => [r.stage, r.hash])).toEqual([['published', 'h1']])

    await recorder.release('h1')
    expect(await all()).toEqual([])
  })

  it('lists a detached record as may have been sent while its own tab lock is held', async () => {
    await mod.startTabLock()
    const recording = mod.createLocalSendRecorder(store).begin(context)
    await recording.publishing('h1')
    recording.detach()
    await vi.advanceTimersByTimeAsync(SEND_STALE_MS + SEND_HEARTBEAT_MS)

    const listed = await mod.localInterruptedSource.list(Date.now(), { popupStart: false })
    expect(listed.map((r) => [r.stage, r.hash, classify(r).kind])).toEqual([
      ['publishing', 'h1', 'maybeSent'],
    ])
  })

  it('stops the heartbeat and keeps the record at publishing with its hash', async () => {
    const recording = mod.createLocalSendRecorder(store).begin(context)
    await recording.publishing('h1')
    recording.detach()
    const [before] = await all()

    await vi.advanceTimersByTimeAsync(SEND_HEARTBEAT_MS * 4)

    const [after] = await all()
    expect(after).toMatchObject({ stage: 'publishing', hash: 'h1' })
    expect(after.heartbeatAt).toBe(before.heartbeatAt)
  })
})

describe('localInterruptedSource', () => {
  // The sending tab writes with its own module instance; this tab lists
  // with another one, as two tabs would.
  let sender: Mod
  const options = { popupStart: false }

  async function sendFromAnotherTab(stage: 'pow-started' | 'publishing' | 'published') {
    sender = await freshModule()
    await sender.startTabLock()
    const recording = sender.createLocalSendRecorder(store).begin(context)
    if (stage !== 'pow-started') await recording.publishing('h1')
    if (stage === 'published') recording.published('h1')
    await vi.advanceTimersByTimeAsync(0)
    const lockName = locks.held().at(-1) as string
    // The record's heartbeat goes stale: the sender is throttled or gone.
    vi.setSystemTime(NOW + SEND_STALE_MS + 1000)
    return lockName
  }

  async function listing() {
    mod = await freshModule()
    mod.createLocalSendRecorder(store)
    return mod.localInterruptedSource.list(Date.now(), options)
  }

  it('does not list a stale pow-started record whose lock is held', async () => {
    await sendFromAnotherTab('pow-started')

    expect(await listing()).toEqual([])
  })

  it('lists it with senderGone and classifies it notSent once the lock is released', async () => {
    const lockName = await sendFromAnotherTab('pow-started')
    locks.release(lockName)

    const found = await listing()

    expect(found).toHaveLength(1)
    expect(found[0].senderGone).toBe(true)
    expect(classify(found[0])).toEqual({ kind: 'notSent' })
  })

  it('classifies a stale publishing record with the lock released as maybeSent', async () => {
    const lockName = await sendFromAnotherTab('publishing')
    locks.release(lockName)

    const found = await listing()

    expect(found).toHaveLength(1)
    expect(classify(found[0])).toEqual({ kind: 'maybeSent' })
  })

  it('classifies a record written without a lock as maybeSent, never notSent', async () => {
    // The sender never held a lock, so there is no lock to be absent.
    vi.stubGlobal('navigator', {})
    sender = await freshModule()
    sender.createLocalSendRecorder(store).begin(context)
    await vi.advanceTimersByTimeAsync(0)
    locks = installFakeLocks()
    vi.setSystemTime(NOW + SEND_STALE_MS + 1000)

    const found = await listing()

    expect(found).toHaveLength(1)
    expect(found[0].senderGone).toBe(false)
    expect(classify(found[0])).toEqual({ kind: 'maybeSent' })
  })

  it('lists a stale pow-started record as maybeSent when navigator.locks is missing', async () => {
    const lockName = await sendFromAnotherTab('pow-started')
    locks.release(lockName)
    vi.stubGlobal('navigator', {})

    const found = await listing()

    expect(found[0].senderGone).toBe(false)
    expect(classify(found[0])).toEqual({ kind: 'maybeSent' })
  })

  it('lists a stale pow-started record as maybeSent when query rejects', async () => {
    await sendFromAnotherTab('pow-started')
    vi.stubGlobal('navigator', { locks: { query: () => Promise.reject(new Error('boom')) } })

    const found = await listing()

    expect(found[0].senderGone).toBe(false)
    expect(classify(found[0])).toEqual({ kind: 'maybeSent' })
  })

  it('skips this tab own records and malformed values', async () => {
    mod = await freshModule()
    mod.createLocalSendRecorder(store).begin(context)
    await store.put({ id: 'junk' } as unknown as SendRecord, { durable: false })
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(NOW + SEND_STALE_MS + 1000)

    expect(await mod.localInterruptedSource.list(Date.now(), options)).toEqual([])
    expect(await store.list()).toHaveLength(2)
  })

  it('lists a published record for tracking even while its sender lock is held', async () => {
    await sendFromAnotherTab('published')

    const found = await listing()

    expect(found).toHaveLength(1)
    expect(classify(found[0])).toEqual({ kind: 'track', hash: 'h1' })
  })

  it('remove deletes the record from the store', async () => {
    const lockName = await sendFromAnotherTab('pow-started')
    locks.release(lockName)
    const [found] = await listing()

    await mod.localInterruptedSource.remove(found.id)

    expect(await all()).toEqual([])
  })
})

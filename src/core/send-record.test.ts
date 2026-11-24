import { describe, expect, it } from 'vitest'

import { SEND_STALE_MS } from '@/config'
import { classify, isSendRecord, pickInterrupted } from './send-record'
import type { SendRecord, SenderState } from './send-record'

const NOW = 1_700_000_000_000
const STALE = NOW - SEND_STALE_MS - 1

function record(over: Partial<SendRecord> & { id: string }): SendRecord {
  return {
    surface: 'web',
    stage: 'pow-started',
    context: { kind: 'send', title: 'Send ZNN', from: 'z1from' },
    startedAt: NOW,
    heartbeatAt: NOW,
    ...over,
  }
}

const noOwn = new Set<string>()
const state = (s: SenderState) => () => Promise.resolve(s)
const ids = (list: { id: string }[]) => list.map((r) => r.id)

describe('classify', () => {
  it('tracks a published record by hash', () => {
    expect(classify(record({ id: 'a', stage: 'published', hash: 'h1' }))).toEqual({
      kind: 'track',
      hash: 'h1',
    })
  })

  it('treats a publishing record as maybe sent, even when the sender is proven gone', () => {
    const r = record({ id: 'b', stage: 'publishing', hash: 'h1' })
    expect(classify(r)).toEqual({ kind: 'maybeSent' })
    expect(classify({ ...r, senderGone: true })).toEqual({ kind: 'maybeSent' })
  })

  it('treats a pow-started record as not sent only when the sender is proven gone', () => {
    const r = record({ id: 'c' })
    expect(classify({ ...r, senderGone: true })).toEqual({ kind: 'notSent' })
  })

  it('treats a pow-started record with an unproven sender as maybe sent', () => {
    const r = record({ id: 'c' })
    expect(classify(r)).toEqual({ kind: 'maybeSent' })
    expect(classify({ ...r, senderGone: false })).toEqual({ kind: 'maybeSent' })
  })
})

describe('isSendRecord', () => {
  it('rejects a published record without a hash', () => {
    expect(isSendRecord(record({ id: 'a', stage: 'published' }))).toBe(false)
  })
})

describe('pickInterrupted', () => {
  it('skips malformed values and own ids', async () => {
    const values = [
      null,
      'x',
      { id: 'bad' },
      record({ id: 'own', heartbeatAt: STALE }),
      record({ id: 'ok', heartbeatAt: STALE }),
    ]

    const found = await pickInterrupted(
      values,
      NOW,
      { popupStart: false },
      new Set(['own']),
      state('gone')
    )

    expect(ids(found)).toEqual(['ok'])
  })

  it('keeps a stale record, a popup record at popup start and a kept record, and drops a fresh one', async () => {
    const values = [
      record({ id: 'stale', heartbeatAt: STALE }),
      record({ id: 'popup', surface: 'popup' }),
      record({ id: 'kept' }),
      record({ id: 'fresh' }),
    ]

    const found = await pickInterrupted(
      values,
      NOW,
      { popupStart: true, keep: new Set(['kept']) },
      noOwn,
      state('gone')
    )

    expect(ids(found).sort()).toEqual(['kept', 'popup', 'stale'])
  })

  it('does not keep a popup record when it is not popup start', async () => {
    const found = await pickInterrupted(
      [record({ id: 'popup', surface: 'popup' })],
      NOW,
      { popupStart: false },
      noOwn,
      state('gone')
    )
    expect(found).toEqual([])
  })

  it('drops an alive sender unpublished record and keeps an alive sender published record', async () => {
    const values = [
      record({ id: 'a', heartbeatAt: STALE }),
      record({ id: 'b', stage: 'publishing', hash: 'h', heartbeatAt: STALE }),
      record({ id: 'c', stage: 'published', hash: 'h2', heartbeatAt: STALE }),
    ]

    const found = await pickInterrupted(values, NOW, { popupStart: false }, noOwn, state('alive'))

    expect(ids(found)).toEqual(['c'])
  })

  it('sets senderGone true only for a gone sender', async () => {
    const values = [
      record({ id: 'g', heartbeatAt: STALE }),
      record({ id: 'u', heartbeatAt: STALE }),
    ]
    const lookup = (r: SendRecord): Promise<SenderState> =>
      Promise.resolve(r.id === 'g' ? 'gone' : 'unknown')

    const found = await pickInterrupted(values, NOW, { popupStart: false }, noOwn, lookup)

    expect(found.map((r) => [r.id, r.senderGone])).toEqual([
      ['g', true],
      ['u', false],
    ])
  })

  it('sorts oldest first', async () => {
    const values = [
      record({ id: 'new', startedAt: 30, heartbeatAt: STALE }),
      record({ id: 'old', startedAt: 10, heartbeatAt: STALE }),
      record({ id: 'mid', startedAt: 20, heartbeatAt: STALE }),
    ]

    const found = await pickInterrupted(values, NOW, { popupStart: false }, noOwn, state('gone'))

    expect(ids(found)).toEqual(['old', 'mid', 'new'])
  })
})

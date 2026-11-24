import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_WC_SESSION_META } from '@/config'

const mocks = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  sets: [] as unknown[],
  delay: false,
}))

vi.mock('./storage/storage-service', () => ({
  storageService: {
    get: async (key: string) => {
      const value = mocks.store.has(key) ? structuredClone(mocks.store.get(key)) : null
      if (mocks.delay) await new Promise((resolve) => setTimeout(resolve, 0))
      return value
    },
    set: async (key: string, value: unknown) => {
      if (mocks.delay) await new Promise((resolve) => setTimeout(resolve, 0))
      mocks.sets.push(structuredClone(value))
      mocks.store.set(key, structuredClone(value))
    },
  },
}))

import { pruneSessionMeta, readSessionMeta, recordSessionMeta } from './walletconnect-session-meta'

const META = { verification: 'valid', approvedAt: 1_700_000_000_000 } as const

beforeEach(() => {
  mocks.store.clear()
  mocks.sets.length = 0
  mocks.delay = false
})

describe('session meta', () => {
  it('reads an empty record when nothing is stored', async () => {
    expect(await readSessionMeta()).toEqual({})
  })

  it('records then reads a topic', async () => {
    await recordSessionMeta('t1', META)

    expect(await readSessionMeta()).toEqual({ t1: META })
  })

  it('keeps earlier topics when a second is recorded', async () => {
    await recordSessionMeta('t1', META)
    await recordSessionMeta('t2', { verification: 'unknown', approvedAt: 5 })

    expect(Object.keys(await readSessionMeta()).sort()).toEqual(['t1', 't2'])
  })

  it.each([
    ['a bad verification', { verification: 'scam', approvedAt: 5 }],
    ['a missing verification', { approvedAt: 5 }],
    ['a string approvedAt', { verification: 'valid', approvedAt: '5' }],
    ['a zero approvedAt', { verification: 'valid', approvedAt: 0 }],
    ['a negative approvedAt', { verification: 'valid', approvedAt: -1 }],
    ['a NaN approvedAt', { verification: 'valid', approvedAt: NaN }],
    ['a null entry', null],
    ['a scalar entry', 'x'],
  ])('reads %s as absent and keeps the good entry', async (_name, bad) => {
    mocks.store.set(STORAGE_KEY_WC_SESSION_META, { bad, good: META })

    expect(await readSessionMeta()).toEqual({ good: META })
  })

  it.each([
    ['null', null],
    ['an array', [META]],
    ['a scalar', 'x'],
    ['a number', 4],
  ])('reads %s as an empty record', async (_name, value) => {
    mocks.store.set(STORAGE_KEY_WC_SESSION_META, value)

    expect(await readSessionMeta()).toEqual({})
  })
})

describe('pruneSessionMeta', () => {
  it('keeps only the live topics', async () => {
    await recordSessionMeta('a', META)
    await recordSessionMeta('b', META)
    await recordSessionMeta('c', META)

    await pruneSessionMeta(['b'])

    expect(Object.keys(await readSessionMeta())).toEqual(['b'])
  })

  it('writes nothing when no entry is removed', async () => {
    await recordSessionMeta('a', META)
    mocks.sets.length = 0

    await pruneSessionMeta(['a', 'other'])

    expect(mocks.sets).toEqual([])
  })

  it('writes nothing when storage is empty', async () => {
    await pruneSessionMeta([])

    expect(mocks.sets).toEqual([])
  })

  it('empties the record when no topic is live', async () => {
    await recordSessionMeta('a', META)

    await pruneSessionMeta([])

    expect(await readSessionMeta()).toEqual({})
  })

  it('lands both a prune and a record started together', async () => {
    await recordSessionMeta('old', META)
    mocks.delay = true

    await Promise.all([pruneSessionMeta(['keep']), recordSessionMeta('keep', META)])

    mocks.delay = false
    expect(Object.keys(await readSessionMeta())).toEqual(['keep'])
  })

  it('lands both a record and a prune started together', async () => {
    await recordSessionMeta('old', META)
    mocks.delay = true

    await Promise.all([recordSessionMeta('new', META), pruneSessionMeta(['new'])])

    mocks.delay = false
    expect(Object.keys(await readSessionMeta())).toEqual(['new'])
  })
})

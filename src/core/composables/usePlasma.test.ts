import { beforeEach, describe, expect, it, vi } from 'vitest'

const plasmaService = { getFusionEntries: vi.fn() }

vi.mock('../plasma-service', () => ({
  PlasmaService: { getInstance: () => plasmaService },
}))
vi.mock('../transaction-service', () => ({
  TransactionService: { getInstance: () => ({}) },
}))
vi.mock('../session-manager', () => ({ sessionManager: {} }))
vi.mock('./useActivity', () => ({ runActivity: vi.fn() }))
vi.mock('./useTxTracker', () => ({ trackTransaction: vi.fn() }))

import { usePlasma } from './usePlasma'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const entry = (id: string) => ({ id })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadFusionEntries', () => {
  it('keeps the newest load when an older one resolves last', async () => {
    const first = deferred<{ list: unknown[] }>()
    const second = deferred<{ list: unknown[] }>()
    plasmaService.getFusionEntries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const plasma = usePlasma()

    const a = plasma.loadFusionEntries('z1a')
    const b = plasma.loadFusionEntries('z1b')
    second.resolve({ list: [entry('b')] })
    await b
    first.resolve({ list: [entry('a')] })
    await a

    expect(plasma.fusionEntries.value).toEqual([entry('b')])
    expect(plasma.isLoading.value).toBe(false)
  })

  it('ignores an older failure after a newer load', async () => {
    const first = deferred<{ list: unknown[] }>()
    plasmaService.getFusionEntries
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ list: [entry('b')] })
    const plasma = usePlasma()

    const a = plasma.loadFusionEntries('z1a')
    await plasma.loadFusionEntries('z1b')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    first.resolve(Promise.reject(new Error('boom')) as never)
    await a

    expect(plasma.fusionEntries.value).toEqual([entry('b')])
    expect(plasma.error.value).toBeNull()
  })

  it('stays loading while the newest load is pending after an older one resolves', async () => {
    const first = deferred<{ list: unknown[] }>()
    const second = deferred<{ list: unknown[] }>()
    plasmaService.getFusionEntries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const plasma = usePlasma()

    const a = plasma.loadFusionEntries('z1a')
    const b = plasma.loadFusionEntries('z1b')
    first.resolve({ list: [entry('a')] })
    await a

    expect(plasma.isLoading.value).toBe(true)
    second.resolve({ list: [] })
    await b
  })
})

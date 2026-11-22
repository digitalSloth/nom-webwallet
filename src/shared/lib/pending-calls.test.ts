import { beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => ({ entries: new Map<string, { done: boolean }>() }))

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: (hash: string) => tracked.entries.get(hash) ?? null }),
}))

import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'

type Pending = typeof import('./pending-calls')
let pending: Pending

const block = (hash: string) => ({ hash: { toString: () => hash } })

beforeEach(async () => {
  vi.resetModules()
  tracked.entries.clear()
  pending = await import('./pending-calls')
})

describe('claimPending', () => {
  it('lets the first caller in and refuses a second while running', () => {
    expect(pending.claimPending('k')).toBe(true)
    expect(pending.isPending('k')).toBe(true)
    expect(pending.claimPending('k')).toBe(false)
  })

  it('keeps keys independent', () => {
    expect(pending.claimPending('a')).toBe(true)
    expect(pending.claimPending('b')).toBe(true)
  })
})

describe('settlePending', () => {
  it('releases a key on none', () => {
    pending.claimPending('k')
    pending.settlePending('k', 'none')

    expect(pending.isPending('k')).toBe(false)
    expect(pending.claimPending('k')).toBe(true)
  })

  it('keeps an unknown outcome pending for good', () => {
    pending.claimPending('k')
    pending.settlePending('k', 'unknown')

    expect(pending.isPending('k')).toBe(true)
    expect(pending.claimPending('k')).toBe(false)
  })

  it('keeps a hash pending while the node does not show the effect', () => {
    pending.claimPending('k')
    pending.settlePending('k', { hash: 'h1' })

    // no tracker entry yet
    expect(pending.isPending('k')).toBe(true)
    // tracker entry exists but is not done
    tracked.entries.set('h1', { done: false })
    expect(pending.claimPending('k')).toBe(false)
  })

  it('releases a hash once its tracker entry is done', () => {
    pending.claimPending('k')
    pending.settlePending('k', { hash: 'h1' })
    tracked.entries.set('h1', { done: true })

    expect(pending.isPending('k')).toBe(false)
    expect(pending.claimPending('k')).toBe(true)
  })
})

describe('runPending', () => {
  it('runs once, returns the block and holds the key until the tracker is done', async () => {
    const run = vi.fn(async () => block('h1'))

    const result = await pending.runPending('k', run)

    expect(result?.hash.toString()).toBe('h1')
    expect(pending.isPending('k')).toBe(true)
    expect(await pending.runPending('k', run)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)

    tracked.entries.set('h1', { done: true })
    expect(await pending.runPending('k', run)).not.toBeNull()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('does not run a second call while the first is in progress', async () => {
    let finish!: (b: ReturnType<typeof block>) => void
    const first = pending.runPending(
      'k',
      () => new Promise<ReturnType<typeof block>>((r) => (finish = r))
    )
    const second = vi.fn(async () => block('h2'))

    expect(await pending.runPending('k', second)).toBeNull()
    expect(second).not.toHaveBeenCalled()

    finish(block('h1'))
    await first
  })

  it('releases the key and rethrows when the node rejects', async () => {
    await expect(
      pending.runPending('k', async () => {
        throw new Error('rejected')
      })
    ).rejects.toThrow('rejected')

    expect(pending.isPending('k')).toBe(false)
  })

  it('keeps a timed out call blocked for the life of the tab and rethrows', async () => {
    await expect(
      pending.runPending('k', async () => {
        throw new Error(SEND_TIMEOUT_MESSAGE)
      })
    ).rejects.toThrow(SEND_TIMEOUT_MESSAGE)

    expect(pending.isPending('k')).toBe(true)
    const run = vi.fn(async () => block('h'))
    expect(await pending.runPending('k', run)).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('releases the key for a non-Error throw', async () => {
    await expect(
      pending.runPending('k', async () => {
        throw 'nope'
      })
    ).rejects.toBe('nope')

    expect(pending.isPending('k')).toBe(false)
  })
})

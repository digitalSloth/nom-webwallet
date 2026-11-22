import { beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => ({ entries: new Map<string, { done: boolean }>() }))

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: (hash: string) => tracked.entries.get(hash) ?? null }),
}))

import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'

type Delegation = typeof import('./delegation')
type Pending = typeof import('@/shared/lib/pending-calls')
let delegation: Delegation
let pending: Pending

const block = (hash: string) => ({ hash: { toString: () => hash } })
const wallet = { id: 'w' } as unknown as Parameters<Delegation['sendDelegation']>[1]
const asFn = (fn: ReturnType<typeof vi.fn>) =>
  fn as unknown as Parameters<Delegation['sendDelegation']>[0]

beforeEach(async () => {
  vi.resetModules()
  tracked.entries.clear()
  delegation = await import('./delegation')
  pending = await import('@/shared/lib/pending-calls')
})

describe('delegationKey', () => {
  it('prefixes the address', () => {
    expect(delegation.delegationKey('z1a')).toBe('delegation:z1a')
  })

  it('gives a null address its own key that never matches a real address', () => {
    expect(delegation.delegationKey(null)).toBe('delegation:null')
    expect(delegation.delegationKey(null)).not.toBe(delegation.delegationKey('z1a'))
  })
})

describe('delegateMeta', () => {
  it('labels the transaction and its progress with the pillar name', () => {
    expect(delegation.delegateMeta('Beta')).toEqual({
      kind: 'contract',
      title: 'Pillars · Delegate to Beta',
      progress: 'Delegating to Beta',
    })
  })
})

describe('sendDelegation', () => {
  it('calls delegateToPillar exactly once with the label meta and returns its block', async () => {
    const b = block('h1')
    const fn = vi.fn().mockResolvedValue(b)

    const result = await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')

    expect(result).toBe(b)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(wallet, 'z1from', 'Beta', false, {
      kind: 'contract',
      title: 'Pillars · Delegate to Beta',
      progress: 'Delegating to Beta',
    })
  })

  it('blocks a second call while the first runs and resolves null without sending', async () => {
    let release: (b: ReturnType<typeof block>) => void = () => {}
    const fn = vi.fn().mockReturnValue(new Promise((r) => (release = r)))

    const first = delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')
    const second = await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Gamma')

    expect(second).toBeNull()
    expect(fn).toHaveBeenCalledTimes(1)
    release(block('h1'))
    await first
  })

  it('stays pending until the tracked transaction is done', async () => {
    tracked.entries.set('h1', { done: false })
    const fn = vi.fn().mockResolvedValue(block('h1'))

    await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')

    expect(pending.isPending(delegation.delegationKey('z1from'))).toBe(true)
    expect(await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')).toBeNull()
    expect(fn).toHaveBeenCalledTimes(1)

    tracked.entries.set('h1', { done: true })
    expect(pending.isPending(delegation.delegationKey('z1from'))).toBe(false)
  })

  it('shares the guard with undelegate through the same key', async () => {
    const key = delegation.delegationKey('z1from')
    let release: (b: ReturnType<typeof block>) => void = () => {}
    const fn = vi.fn().mockReturnValue(new Promise((r) => (release = r)))

    const first = delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')
    const undelegate = vi.fn().mockResolvedValue(block('h2'))
    const blocked = await pending.runPending(key, undelegate)

    expect(blocked).toBeNull()
    expect(undelegate).not.toHaveBeenCalled()
    release(block('h1'))
    await first
  })

  it('does not block a different address', async () => {
    const fn = vi.fn().mockResolvedValue(block('h1'))
    tracked.entries.set('h1', { done: false })

    await delegation.sendDelegation(asFn(fn), wallet, 'z1a', 'Beta')
    const other = await delegation.sendDelegation(asFn(fn), wallet, 'z1b', 'Beta')

    expect(other).not.toBeNull()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('keeps the guard after a send timeout and rethrows', async () => {
    const fn = vi.fn().mockRejectedValue(new Error(SEND_TIMEOUT_MESSAGE))

    await expect(delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')).rejects.toThrow(
      SEND_TIMEOUT_MESSAGE
    )

    expect(pending.isPending(delegation.delegationKey('z1from'))).toBe(true)
    expect(await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')).toBeNull()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('releases the guard after another error so the user can retry', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(block('h1'))

    await expect(delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')).rejects.toThrow(
      'boom'
    )

    expect(pending.isPending(delegation.delegationKey('z1from'))).toBe(false)
    expect(await delegation.sendDelegation(asFn(fn), wallet, 'z1from', 'Beta')).not.toBeNull()
  })
})

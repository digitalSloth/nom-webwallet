import { beforeEach, describe, expect, it, vi } from 'vitest'

const tracked = vi.hoisted(() => ({
  entries: new Map<string, { done: boolean }>(),
  trackRejected: vi.fn(),
}))

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: (hash: string) => tracked.entries.get(hash) ?? null }),
  trackRejected: tracked.trackRejected,
}))

import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'

type Action = typeof import('./contract-action')
type Pending = typeof import('@/shared/lib/pending-calls')
let action: Action
let PublishRejectedError: typeof import('@/core/transaction-service').PublishRejectedError
let pending: Pending

const FROM = 'z1from'
const meta = { kind: 'contract', title: 'HTLC · Reclaim 1 ZNN' } as never
const sentBlock = { hash: { toString: () => 'hash1' } } as never

function wallet(over: { active?: unknown; unlocked?: boolean; address?: string | null } = {}) {
  const order: string[] = []
  return {
    order,
    w: {
      refreshLockState: vi.fn(() => order.push('refresh')),
      activeWallet: { value: 'active' in over ? over.active : { id: 'w' } },
      isActiveWalletUnlocked: { value: over.unlocked ?? true },
      activeAccountAddress: { value: 'address' in over ? over.address : FROM },
    } as never,
  }
}

beforeEach(async () => {
  vi.resetModules()
  tracked.entries.clear()
  tracked.trackRejected.mockReset()
  action = await import('./contract-action')
  // The class must come from the same module instance the action module loads
  ;({ PublishRejectedError } = await import('@/core/transaction-service'))
  pending = await import('@/shared/lib/pending-calls')
})

const run = (w: never, send: (x: never) => Promise<unknown>, key = 'k') =>
  action.runContractAction({
    key,
    from: FROM,
    wallet: w,
    meta,
    node: 'node.example',
    send: send as never,
  })

describe('runContractAction', () => {
  it('refreshes the lock state, then skips without sending when the wallet is locked', async () => {
    const { w, order } = wallet({ unlocked: false })
    const send = vi.fn(async () => {
      order.push('send')
      return sentBlock
    })
    expect(await run(w, send)).toEqual({ kind: 'skipped' })
    expect(order).toEqual(['refresh'])
    expect(send).not.toHaveBeenCalled()
  })

  it('skips without sending when there is no active wallet', async () => {
    const { w } = wallet({ active: null })
    const send = vi.fn()
    expect(await run(w, send as never)).toEqual({ kind: 'skipped' })
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a moved account without sending and without claiming the key', async () => {
    const { w } = wallet({ address: 'z1other' })
    const send = vi.fn()
    expect(await run(w, send as never)).toEqual({
      kind: 'error',
      message: 'The active account changed. Review this again from the current account.',
      timeout: false,
    })
    expect(send).not.toHaveBeenCalled()
    expect(pending.isPending('k')).toBe(false)
  })

  it('refuses a null active account without sending', async () => {
    const { w } = wallet({ address: null })
    const send = vi.fn()
    expect((await run(w, send as never)).kind).toBe('error')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends with the active wallet and returns the hash', async () => {
    const { w } = wallet()
    const send = vi.fn(async () => sentBlock)
    expect(await run(w, send)).toEqual({ kind: 'sent', hash: 'hash1' })
    expect(send).toHaveBeenCalledWith({ id: 'w' })
  })

  it('skips a second call under a key that is already pending and does not send', async () => {
    const { w } = wallet()
    pending.claimPending('k')
    const send = vi.fn()
    expect(await run(w, send as never)).toEqual({ kind: 'skipped' })
    expect(send).not.toHaveBeenCalled()
  })

  it('tracks a node refusal and reports that nothing was sent', async () => {
    const { w } = wallet()
    const result = await run(w, async () => {
      throw new PublishRejectedError('invalid hash type')
    })
    expect(tracked.trackRejected).toHaveBeenCalledWith({
      label: 'HTLC · Reclaim 1 ZNN',
      address: FROM,
      meta,
      reason: 'invalid hash type',
      node: 'node.example',
    })
    expect(result).toEqual({
      kind: 'error',
      message: 'The node refused this transaction. Nothing was sent: invalid hash type',
      timeout: false,
    })
    expect(pending.isPending('k')).toBe(false)
  })

  it('keeps the key pending after a timeout', async () => {
    const { w } = wallet()
    const result = await run(w, async () => {
      throw new Error(SEND_TIMEOUT_MESSAGE)
    })
    expect(result).toEqual({ kind: 'error', message: SEND_TIMEOUT_MESSAGE, timeout: true })
    expect(pending.isPending('k')).toBe(true)
  })

  it('returns another error message with no timeout and releases the key', async () => {
    const { w } = wallet()
    const result = await run(w, async () => {
      throw new Error('This HTLC no longer exists. Nothing was sent.')
    })
    expect(result).toEqual({
      kind: 'error',
      message: 'This HTLC no longer exists. Nothing was sent.',
      timeout: false,
    })
    expect(pending.isPending('k')).toBe(false)
    expect(tracked.trackRejected).not.toHaveBeenCalled()
  })

  it('uses the fallback message for a non-Error throw', async () => {
    const { w } = wallet()
    const result = await run(w, async () => {
      throw 'nope'
    })
    expect(result).toEqual({
      kind: 'error',
      message: 'Failed to send the transaction',
      timeout: false,
    })
  })
})

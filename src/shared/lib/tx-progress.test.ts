import { describe, expect, it } from 'vitest'

import type { TrackedEntry, TrackedTx, TxStage } from '@/core'
import { rejectedBanner, toastEntry, txKind, txProgress } from './tx-progress'

const tx = (meta?: TrackedTx['meta']): TrackedTx => ({
  hash: 'h',
  label: 'Send',
  address: 'z1a',
  publishedAt: 0,
  ...(meta ? { meta } : {}),
})

describe('txProgress', () => {
  it('published: step 1, pending', () => {
    expect(txProgress({ kind: 'published' }, 'transfer')).toEqual({
      reached: 1,
      status: 'pending',
      label: 'Published',
      text: 'Published, waiting for the network',
      momentum: null,
      banner: null,
    })
  })

  it('confirmed: step 2, confirming, waiting for the contract', () => {
    expect(txProgress({ kind: 'confirmed', momentum: 1234567 }, 'contract')).toEqual({
      reached: 2,
      status: 'confirming',
      label: 'Confirming',
      text: 'Confirmed in momentum 1,234,567, waiting for the contract',
      momentum: 1234567,
      banner: null,
    })
  })

  it('awaitingRecipient: step 2, confirmed, waiting for the recipient', () => {
    expect(txProgress({ kind: 'awaitingRecipient', momentum: 10 }, 'transfer')).toEqual({
      reached: 2,
      status: 'success',
      label: 'Confirmed',
      text: 'Confirmed in momentum 10, waiting for the recipient',
      momentum: 10,
      banner: null,
    })
  })

  it('received by a recipient: step 3 with recipient wording', () => {
    expect(txProgress({ kind: 'received', momentum: 10 }, 'transfer')).toEqual({
      reached: 3,
      status: 'success',
      label: 'Received',
      text: 'Received by the recipient',
      momentum: 10,
      banner: null,
    })
  })

  it('received for a receive: step 3 with the momentum', () => {
    expect(txProgress({ kind: 'received', momentum: 2000 }, 'receive')).toMatchObject({
      reached: 3,
      label: 'Received',
      text: 'Received in momentum 2,000',
      momentum: 2000,
    })
  })

  it('executed with no follow-ons: step 3, executed', () => {
    expect(txProgress({ kind: 'executed', pendingFollowOns: 0 }, 'contract')).toEqual({
      reached: 3,
      status: 'success',
      label: 'Executed',
      text: 'Contract executed',
      momentum: null,
      banner: null,
    })
  })

  it('executed with one follow-on uses the singular', () => {
    expect(txProgress({ kind: 'executed', pendingFollowOns: 1 }, 'contract')).toEqual({
      reached: 2,
      status: 'confirming',
      label: 'Confirming',
      text: 'Executed, waiting for 1 follow-on block',
      momentum: null,
      banner: null,
    })
  })

  it('executed with several follow-ons uses the plural', () => {
    expect(txProgress({ kind: 'executed', pendingFollowOns: 3 }, 'contract').text).toBe(
      'Executed, waiting for 3 follow-on blocks'
    )
  })

  it('failed: step 2, failed status and the failed banner', () => {
    expect(txProgress({ kind: 'failed', momentum: 5 }, 'contract')).toEqual({
      reached: 2,
      status: 'failed',
      label: 'Failed',
      text: 'Confirmed in momentum 5, but the contract call failed',
      momentum: 5,
      banner: 'failed',
    })
  })

  it('timedOut: step 1, pending and the stale banner', () => {
    expect(txProgress({ kind: 'timedOut' }, 'transfer')).toEqual({
      reached: 1,
      status: 'pending',
      label: 'Still waiting',
      text: 'Still waiting after several minutes. Check the explorer.',
      momentum: null,
      banner: 'stale',
    })
  })

  it('covers every stage kind', () => {
    const stages: TxStage[] = [
      { kind: 'published' },
      { kind: 'confirmed', momentum: 1 },
      { kind: 'awaitingRecipient', momentum: 1 },
      { kind: 'received', momentum: 1 },
      { kind: 'executed', pendingFollowOns: 0 },
      { kind: 'failed', momentum: 1 },
      { kind: 'timedOut' },
    ]
    for (const stage of stages) expect(txProgress(stage, 'transfer').label).not.toBe('')
  })
})

describe('txKind', () => {
  it.each([
    ['receive', 'receive'],
    ['contract', 'contract'],
    ['send', 'transfer'],
  ] as const)('maps meta.kind %s to %s', (kind, expected) => {
    expect(txKind(tx({ kind, title: 'x' }))).toBe(expected)
  })

  it('is a transfer without meta', () => {
    expect(txKind(tx())).toBe('transfer')
  })
})

describe('rejected sends', () => {
  it('rejected: step 0, failed status, Not sent, the rejected banner', () => {
    expect(
      txProgress(
        { kind: 'rejected', reason: 'insufficient balance', node: 'node.zenonhub.io' },
        'transfer'
      )
    ).toEqual({
      reached: 0,
      status: 'failed',
      label: 'Not sent',
      text: 'Not published, rejected by node.zenonhub.io',
      momentum: null,
      banner: 'rejected',
    })
  })

  it.each(['insufficient balance', 'insufficient balance.', 'insufficient balance...'])(
    'rejectedBanner(%j) names the reason once and says nothing was sent',
    (reason) => {
      expect(rejectedBanner(reason)).toBe(
        'The node rejected the transaction: insufficient balance. Nothing was sent.'
      )
    }
  )
})

describe('toastEntry', () => {
  const NOW = 100_000
  const entry = (
    hash: string,
    address: string,
    over: Partial<Omit<TrackedEntry, 'tx'>> = {}
  ): TrackedEntry => ({
    tx: { ...tx(), hash, address },
    stage: { kind: 'published' },
    done: false,
    updatedAt: NOW,
    ...over,
  })

  it('is null without an active address', () => {
    expect(toastEntry([entry('a', 'z1a')], null, NOW)).toBeNull()
  })

  it('is null when nothing matches', () => {
    expect(toastEntry([], 'z1a', NOW)).toBeNull()
    expect(toastEntry([entry('b', 'z1b')], 'z1a', NOW)).toBeNull()
  })

  it('skips a newer entry from another account', () => {
    const mine = entry('a', 'z1a')
    expect(toastEntry([entry('b', 'z1b'), mine], 'z1a', NOW)).toBe(mine)
  })

  it('returns the newest in-flight entry of the account', () => {
    const newest = entry('n', 'z1a')
    expect(toastEntry([newest, entry('o', 'z1a')], 'z1a', NOW)).toBe(newest)
  })

  it('skips a rejected entry', () => {
    const rejected = entry('r', 'z1a', { stage: { kind: 'rejected', node: 'n', reason: 'x' } })
    const ok = entry('a', 'z1a')
    expect(toastEntry([rejected, ok], 'z1a', NOW)).toBe(ok)
    expect(toastEntry([rejected], 'z1a', NOW)).toBeNull()
  })

  it('keeps a done entry for 5 s and then drops it', () => {
    const done = entry('d', 'z1a', { done: true, updatedAt: NOW - 5_000 })
    expect(toastEntry([done], 'z1a', NOW)).toBe(done)
    expect(toastEntry([done], 'z1a', NOW + 1)).toBeNull()
  })

  it('shows each account its own entry and leaves the list intact when switching back', () => {
    const list = [entry('b', 'z1b'), entry('a', 'z1a')]
    const snapshot = [...list]
    expect(toastEntry(list, 'z1a', NOW)).toBe(list[1])
    expect(toastEntry(list, 'z1b', NOW)).toBe(list[0])
    expect(toastEntry(list, 'z1a', NOW)).toBe(list[1])
    expect(list).toEqual(snapshot)
  })

  it('does not bring back another account done entry after its window has passed', () => {
    const old = entry('d', 'z1a', { done: true, updatedAt: NOW - 60_000 })
    expect(toastEntry([old], 'z1a', NOW)).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ sendTransaction: vi.fn(), receiveTransaction: vi.fn() }))

vi.mock('../transaction-service', () => ({
  TransactionService: {
    getInstance: () => ({
      sendTransaction: mocks.sendTransaction,
      receiveTransaction: mocks.receiveTransaction,
    }),
  },
}))
vi.mock('./useTxTracker', () => ({ trackTransaction: vi.fn() }))

import { sessionManager } from '../session-manager'
import type { SessionBackend } from '../session-manager'
import { useTransaction } from './useTransaction'

const wallet = {
  baseAddress: 'z1base',
  accounts: [{ index: 0, address: 'z1from' }],
} as never
const keyStore = { getKeyPair: () => ({}) } as never

function attach(expired: boolean): void {
  const backend: SessionBackend = {
    isExpired: () => expired,
    unlocked: () => {},
    locked: () => {},
  }
  sessionManager.attach(backend)
}

beforeEach(() => {
  mocks.sendTransaction.mockReset()
  mocks.sendTransaction.mockResolvedValue({ hash: { toString: () => 'h' } })
  sessionManager.drop(null)
  sessionManager.unlock('z1base', keyStore)
})

describe('useTransaction.sendTransaction', () => {
  it('rejects with the locked message and never signs when the session has expired', async () => {
    attach(true)

    await expect(
      useTransaction().sendTransaction(wallet, 'z1from', 'z1to', 'zts1znn', 1n)
    ).rejects.toThrow('Wallet is locked. Please unlock it first.')

    expect(mocks.sendTransaction).not.toHaveBeenCalled()
  })

  it('signs and publishes while the session is live', async () => {
    attach(false)

    await useTransaction().sendTransaction(wallet, 'z1from', 'z1to', 'zts1znn', 1n)

    expect(mocks.sendTransaction).toHaveBeenCalledTimes(1)
  })
})

describe('useTransaction.receiveTransaction', () => {
  beforeEach(() => {
    mocks.receiveTransaction.mockReset()
    mocks.receiveTransaction.mockResolvedValue({ hash: { toString: () => 'h' } })
  })

  it('passes the beforePublish check and the context through to the service', async () => {
    attach(false)
    const beforePublish = vi.fn()
    const meta = {
      kind: 'receive',
      title: 'Auto-receive',
      progress: 'p',
      background: true,
    } as never

    await useTransaction().receiveTransaction(wallet, 'z1from', 'hash1', meta, beforePublish)

    expect(mocks.receiveTransaction).toHaveBeenCalledWith(
      'hash1',
      expect.anything(),
      { ...(meta as object), from: 'z1from' },
      beforePublish
    )
  })

  it('rejects with the locked message and never receives when the session has expired', async () => {
    attach(true)

    await expect(
      useTransaction().receiveTransaction(wallet, 'z1from', 'hash1', undefined, vi.fn())
    ).rejects.toThrow('Wallet is locked. Please unlock it first.')

    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })
})

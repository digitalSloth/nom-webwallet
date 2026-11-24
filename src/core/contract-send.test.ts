import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getKeyStore: vi.fn(),
  sendEmbeddedContractBlock: vi.fn(),
  runActivity: vi.fn(),
  trackTransaction: vi.fn(),
}))

vi.mock('./session-manager', () => ({ sessionManager: { getKeyStore: mocks.getKeyStore } }))
vi.mock('./transaction-service', () => ({
  TransactionService: {
    getInstance: () => ({ sendEmbeddedContractBlock: mocks.sendEmbeddedContractBlock }),
  },
}))
vi.mock('./composables/useActivity', () => ({ runActivity: mocks.runActivity }))
vi.mock('./composables/useTxTracker', () => ({ trackTransaction: mocks.trackTransaction }))

import { TokenStandard, Zenon, ZNN_ZTS } from 'znn-typescript-sdk'
import { sendContractCall } from './contract-send'
import { getSendRecorder, setSendRecorder } from './send-recorder'

const wallet = {
  baseAddress: 'z1base',
  accounts: [
    { address: 'z1a', index: 0 },
    { address: 'z1b', index: 3 },
  ],
} as never
const block = { data: new Uint8Array([1, 2, 3]) } as never
const meta = { kind: 'contract', title: 'HTLC · Unlock' } as never
const keyPair = { id: 'kp' }
const consoles = ['log', 'info', 'warn', 'error', 'debug'] as const

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.getKeyStore.mockReturnValue({ getKeyPair: vi.fn().mockReturnValue(keyPair) })
  mocks.runActivity.mockImplementation(async (_a: string, fn: () => Promise<unknown>) => fn())
  for (const c of consoles) vi.spyOn(console, c).mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('sendContractCall', () => {
  it('throws the locked text and sends nothing when the key store is missing', async () => {
    mocks.getKeyStore.mockReturnValue(null)
    await expect(
      sendContractCall({ wallet, from: 'z1a', block, meta, activity: 'x' })
    ).rejects.toThrow('Wallet is locked. Please unlock it first.')
    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(mocks.runActivity).not.toHaveBeenCalled()
  })

  it('throws Account not found and sends nothing for an unknown from', async () => {
    await expect(
      sendContractCall({ wallet, from: 'z1zzz', block, meta, activity: 'x' })
    ).rejects.toThrow('Account not found')
    expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
  })

  it('signs with the account index key and sends with { ...meta, from }', async () => {
    const getKeyPair = vi.fn().mockReturnValue(keyPair)
    mocks.getKeyStore.mockReturnValue({ getKeyPair })
    const sent = { hash: 'h' }
    mocks.sendEmbeddedContractBlock.mockResolvedValue(sent)

    const result = await sendContractCall({
      wallet,
      from: 'z1b',
      block,
      meta,
      activity: 'Unlocking HTLC',
    })

    expect(result).toBe(sent)
    expect(getKeyPair).toHaveBeenCalledWith(3)
    expect(mocks.sendEmbeddedContractBlock).toHaveBeenCalledWith(block, keyPair, undefined, {
      ...(meta as object),
      from: 'z1b',
    })
    expect(mocks.runActivity.mock.calls[0][0]).toBe('Unlocking HTLC')
    expect(mocks.trackTransaction).toHaveBeenCalledWith('HTLC · Unlock', sent, meta)
  })

  it('rethrows a send error unchanged, tracks nothing and logs nothing', async () => {
    const err = new Error('boom')
    mocks.sendEmbeddedContractBlock.mockRejectedValue(err)

    await expect(
      sendContractCall({ wallet, from: 'z1a', block, meta, activity: 'x' })
    ).rejects.toBe(err)

    expect(mocks.trackTransaction).not.toHaveBeenCalled()
    for (const c of consoles) expect(globalThis.console[c]).not.toHaveBeenCalled()
  })

  it('logs nothing on success', async () => {
    mocks.sendEmbeddedContractBlock.mockResolvedValue({})
    await sendContractCall({ wallet, from: 'z1a', block, meta, activity: 'x' })
    for (const c of consoles) expect(globalThis.console[c]).not.toHaveBeenCalled()
  })

  describe('guarded calls', () => {
    const burn = () =>
      Zenon.getInstance().embedded.token.burnToken(TokenStandard.parse(ZNN_ZTS.toString()), 1n)
    const previous = getSendRecorder()
    afterEach(() => setSendRecorder(previous))

    it('records the call on the send context', async () => {
      mocks.sendEmbeddedContractBlock.mockResolvedValue({})
      await sendContractCall({ wallet, from: 'z1a', block: burn(), meta, activity: 'x' })
      const context = mocks.sendEmbeddedContractBlock.mock.calls[0][3]
      expect(context.call).toMatch(/^Token\.Burn:/)
    })

    it('refuses before the key pair is used when a stored record has the same call', async () => {
      mocks.sendEmbeddedContractBlock.mockResolvedValue({})
      await sendContractCall({ wallet, from: 'z1a', block: burn(), meta, activity: 'x' })
      const call = mocks.sendEmbeddedContractBlock.mock.calls[0][3].call
      mocks.sendEmbeddedContractBlock.mockClear()
      mocks.runActivity.mockClear()
      setSendRecorder({
        begin: previous.begin,
        release: previous.release,
        stored: async () => [{ kind: 'contract', title: 't', from: 'z1a', call }],
      })

      await expect(
        sendContractCall({ wallet, from: 'z1a', block: burn(), meta, activity: 'x' })
      ).rejects.toThrow('A previous burn may still be sending')
      expect(mocks.sendEmbeddedContractBlock).not.toHaveBeenCalled()
      expect(mocks.runActivity).not.toHaveBeenCalled()
    })
  })
})

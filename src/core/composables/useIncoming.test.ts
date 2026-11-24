import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ receiveTransaction: vi.fn() }))
const walletState = vi.hoisted(() => ({
  activeWallet: { value: null as unknown },
  isActiveWalletUnlocked: { value: true },
}))

vi.mock('./useWallet', () => ({
  useWallet: () => ({
    activeWallet: walletState.activeWallet,
    isActiveWalletUnlocked: walletState.isActiveWalletUnlocked,
  }),
}))
vi.mock('./useTransaction', () => ({
  useTransaction: () => ({ receiveTransaction: mocks.receiveTransaction }),
}))

import { PublishRejectedError } from '../transaction-service'
import { useIncoming } from './useIncoming'

const ADDRESS = 'z1active'

function block(n: number, amount = 100n) {
  return {
    hash: { toString: () => `hash${n}` },
    amount,
    tokenStandard: { toString: () => 'zts1znn' },
    token: { symbol: 'ZNN', decimals: 8 },
  } as never
}

function setup(blocks: unknown[]) {
  const loadUnreceivedBlocks = vi.fn().mockResolvedValue({ list: blocks, more: false, count: 0 })
  const loadUnreceivedCount = vi.fn().mockResolvedValue(undefined)
  const onLocked = vi.fn()
  const incoming = useIncoming({
    address: () => ADDRESS,
    account: { loadUnreceivedBlocks, loadUnreceivedCount } as never,
    onLocked,
  })
  return { incoming, loadUnreceivedBlocks, loadUnreceivedCount, onLocked }
}

beforeEach(() => {
  mocks.receiveTransaction.mockReset()
  mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => ({
    hash: { toString: () => `sent-${hash}` },
  }))
  walletState.activeWallet.value = { baseAddress: 'z1base' }
  walletState.isActiveWalletUnlocked.value = true
})

const published = () => mocks.receiveTransaction.mock.calls.map((c) => c[2])

describe('receiveAll', () => {
  it('publishes in list order with receive context and returns the last hash', async () => {
    const { incoming, loadUnreceivedCount } = setup([block(1), block(2), block(3)])
    await incoming.loadFirstPage()

    const last = await incoming.receiveAll()

    expect(published()).toEqual(['hash1', 'hash2', 'hash3'])
    const metas = mocks.receiveTransaction.mock.calls.map((c) => c[3])
    expect(metas.map((m) => m.kind)).toEqual(['receive', 'receive', 'receive'])
    expect(metas.map((m) => m.title)).toEqual([
      'Receive 1 of 3',
      'Receive 2 of 3',
      'Receive 3 of 3',
    ])
    expect(metas.map((m) => m.progress)).toEqual([
      'Receiving 1 of 3',
      'Receiving 2 of 3',
      'Receiving 3 of 3',
    ])
    expect(last).toBe('sent-hash3')
    expect(loadUnreceivedCount).toHaveBeenCalled()
  })

  it('stops at the first failure, sets bulkFailure and returns null', async () => {
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      if (hash === 'hash2') throw new Error('node down')
      return { hash: { toString: () => `sent-${hash}` } }
    })
    const { incoming } = setup([block(1), block(2), block(3)])
    await incoming.loadFirstPage()

    const last = await incoming.receiveAll()

    expect(last).toBeNull()
    expect(incoming.bulkFailure.value).toBe('Receive 2 of 3 failed: node down')
    expect(published()).toEqual(['hash1', 'hash2'])
    expect(incoming.busy.value).toBe(false)
  })

  it('calls onLocked and publishes nothing when the wallet is locked', async () => {
    walletState.isActiveWalletUnlocked.value = false
    const { incoming, onLocked } = setup([block(1)])
    await incoming.loadFirstPage()

    expect(await incoming.receiveAll()).toBeNull()

    expect(onLocked).toHaveBeenCalledTimes(1)
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('skips a block the node says is already received and publishes the rest', async () => {
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      if (hash === 'hash2') {
        throw new PublishRejectedError('account-block from-block already received')
      }
      return { hash: { toString: () => `sent-${hash}` } }
    })
    const { incoming, loadUnreceivedBlocks, loadUnreceivedCount } = setup([
      block(1),
      block(2),
      block(3),
    ])
    await incoming.loadFirstPage()

    const last = await incoming.receiveAll()

    expect(published()).toEqual(['hash1', 'hash2', 'hash3'])
    expect(last).toBe('sent-hash3')
    expect(incoming.bulkFailure.value).toBeNull()
    expect(loadUnreceivedCount).toHaveBeenCalled()
    expect(loadUnreceivedBlocks).toHaveBeenCalledTimes(2)
  })

  it('still stops on any other node refusal', async () => {
    mocks.receiveTransaction.mockRejectedValue(new PublishRejectedError('account-block mismatch'))
    const { incoming } = setup([block(1), block(2)])
    await incoming.loadFirstPage()

    expect(await incoming.receiveAll()).toBeNull()
    expect(incoming.bulkFailure.value).toContain('Receive 1 of 2 failed')
    expect(published()).toEqual(['hash1'])
  })

  it('returns null without a wallet', async () => {
    walletState.activeWallet.value = null
    const { incoming } = setup([block(1)])
    await incoming.loadFirstPage()

    expect(await incoming.receiveAll()).toBeNull()
    expect(mocks.receiveTransaction).not.toHaveBeenCalled()
  })

  it('returns null when nothing was published', async () => {
    const { incoming } = setup([])
    await incoming.loadFirstPage()

    expect(await incoming.receiveAll()).toBeNull()
  })
})

describe('retryAll', () => {
  it('reloads the first page and resumes from the failed block', async () => {
    mocks.receiveTransaction.mockImplementation(async (_w, _a, hash: string) => {
      if (hash === 'hash2' && mocks.receiveTransaction.mock.calls.length === 2)
        throw new Error('node down')
      return { hash: { toString: () => `sent-${hash}` } }
    })
    const { incoming, loadUnreceivedBlocks } = setup([block(1), block(2), block(3)])
    await incoming.loadFirstPage()
    await incoming.receiveAll()
    expect(incoming.bulkFailure.value).not.toBeNull()
    mocks.receiveTransaction.mockClear()
    loadUnreceivedBlocks.mockResolvedValue({ list: [block(2), block(3)], more: false, count: 2 })

    const last = await incoming.retryAll()

    expect(loadUnreceivedBlocks).toHaveBeenCalledTimes(2)
    expect(published()).toEqual(['hash2', 'hash3'])
    expect(incoming.bulkFailure.value).toBeNull()
    expect(last).toBe('sent-hash3')
  })
})

describe('receiveOne', () => {
  it('titles the receive with the formatted amount and symbol', async () => {
    const { incoming } = setup([block(1, 150000000n)])
    await incoming.loadFirstPage()

    await incoming.receiveOne(incoming.blocks.value[0])

    expect(mocks.receiveTransaction.mock.calls[0][3].title).toBe('Receive 1.5 ZNN')
    expect(incoming.blocks.value).toEqual([])
  })

  it('sets error and keeps the block when the receive fails', async () => {
    mocks.receiveTransaction.mockRejectedValue(new Error('nope'))
    const { incoming } = setup([block(1)])
    await incoming.loadFirstPage()

    await incoming.receiveOne(incoming.blocks.value[0])

    expect(incoming.error.value).toBe('nope')
    expect(incoming.blocks.value).toHaveLength(1)
  })
})

describe('shared in-flight guard', () => {
  it('skips blocks another useIncoming instance is already receiving', async () => {
    let release: () => void = () => {}
    mocks.receiveTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ hash: { toString: () => 'sent-hash1' } })
        })
    )
    const first = setup([block(1)])
    const second = setup([block(1)])
    await first.incoming.loadFirstPage()
    await second.incoming.loadFirstPage()

    const running = first.incoming.receiveAll()
    const duplicate = await second.incoming.receiveAll()
    await second.incoming.receiveOne(second.incoming.blocks.value[0])
    release()
    await running

    expect(duplicate).toBeNull()
    expect(second.loadUnreceivedCount).not.toHaveBeenCalled()
    expect(second.incoming.busy.value).toBe(false)
    expect(published()).toEqual(['hash1'])
  })

  it('claims a block while receiveOne runs so receiveAll elsewhere skips it', async () => {
    let release: () => void = () => {}
    mocks.receiveTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ hash: { toString: () => 'sent-hash1' } })
        })
    )
    const first = setup([block(1)])
    const second = setup([block(1)])
    await first.incoming.loadFirstPage()
    await second.incoming.loadFirstPage()

    const running = first.incoming.receiveOne(first.incoming.blocks.value[0])
    const duplicate = await second.incoming.receiveAll()
    release()
    await running

    expect(duplicate).toBeNull()
    expect(published()).toEqual(['hash1'])
  })

  it('releases the hashes once the run settles', async () => {
    const first = setup([block(1)])
    await first.incoming.loadFirstPage()
    await first.incoming.receiveAll()
    await first.incoming.receiveAll()

    expect(published()).toEqual(['hash1', 'hash1'])
  })
})

describe('receiveOne', () => {
  it('drops a row the node says is already received without an error', async () => {
    mocks.receiveTransaction.mockRejectedValue(
      new PublishRejectedError('account-block from-block already received')
    )
    const { incoming, loadUnreceivedCount } = setup([block(1), block(2)])
    await incoming.loadFirstPage()

    await incoming.receiveOne(incoming.blocks.value[0])

    expect(incoming.error.value).toBeNull()
    expect(incoming.blocks.value.map((b) => b.hash.toString())).toEqual(['hash2'])
    expect(loadUnreceivedCount).toHaveBeenCalledTimes(1)
  })
})

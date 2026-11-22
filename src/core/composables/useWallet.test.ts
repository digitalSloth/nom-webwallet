import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getUnlockedWallets: vi.fn<() => string[]>(),
  deleteWallet: vi.fn(async () => {}),
}))

const sendRecords = vi.hoisted(() => ({ removeSendRecordsFrom: vi.fn(async () => {}) }))
vi.mock('../local-send-recorder', () => sendRecords)
vi.mock('../wallet-service', () => ({
  WalletService: { getInstance: () => service },
}))

const { useWallet } = await import('./useWallet')

beforeEach(() => {
  service.getSnapshot.mockResolvedValue({ wallets: [], activeWallet: null, activeAccount: null })
})

describe('useWallet.refreshLockState', () => {
  it('drops a wallet the service no longer reports', async () => {
    const wallet = useWallet()
    service.getUnlockedWallets.mockReturnValue(['z1a', 'z1b'])
    await wallet.loadWalletData()
    expect(wallet.unlockedWallets.value).toEqual(['z1a', 'z1b'])

    service.getUnlockedWallets.mockReturnValue(['z1b'])
    wallet.refreshLockState()

    expect(wallet.unlockedWallets.value).toEqual(['z1b'])
  })

  it('keeps the same array object when the list is unchanged', async () => {
    const wallet = useWallet()
    service.getUnlockedWallets.mockReturnValue(['z1a'])
    await wallet.loadWalletData()
    const before = wallet.unlockedWallets.value

    service.getUnlockedWallets.mockReturnValue(['z1a'])
    wallet.refreshLockState()

    expect(wallet.unlockedWallets.value).toBe(before)
  })

  it('replaces the array when the same count holds a different wallet', async () => {
    const wallet = useWallet()
    service.getUnlockedWallets.mockReturnValue(['z1a'])
    await wallet.loadWalletData()

    service.getUnlockedWallets.mockReturnValue(['z1b'])
    wallet.refreshLockState()

    expect(wallet.unlockedWallets.value).toEqual(['z1b'])
  })
})

describe('useWallet.deleteWallet', () => {
  it('deletes the send records of the removed wallet accounts', async () => {
    const wallet = useWallet()
    service.getSnapshot.mockResolvedValue({
      wallets: [
        { baseAddress: 'z1base', accounts: [{ address: 'z1a' }, { address: 'z1b' }] },
        { baseAddress: 'z1other', accounts: [{ address: 'z1c' }] },
      ],
      activeWallet: null,
      activeAccount: null,
    })
    service.getUnlockedWallets.mockReturnValue([])
    await wallet.loadWalletData()

    await wallet.deleteWallet('z1base')

    expect(service.deleteWallet).toHaveBeenCalledWith('z1base')
    expect(sendRecords.removeSendRecordsFrom).toHaveBeenCalledWith(new Set(['z1a', 'z1b']))
  })
})

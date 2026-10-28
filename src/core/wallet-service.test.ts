import { describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, Wallet, WalletStorage } from '@/types'

const NEW_KEY_FILE = { upgraded: true }

vi.mock('znn-typescript-sdk', () => ({
  KeyStore: {},
  KeyFile: {
    setPassword: () => ({
      decrypt: async () => ({}),
      encrypt: async () => NEW_KEY_FILE,
    }),
    needsUpgrade: () => true,
  },
}))
vi.mock('@/core/session-manager', () => ({ sessionManager: { unlock: vi.fn() } }))

const { WalletService } = await import('@/core/wallet-service')

function wallet(baseAddress: string, encryptedKeyFile: unknown): Wallet {
  return {
    name: baseAddress,
    baseAddress,
    encryptedKeyFile,
    accounts: [{ address: `${baseAddress}-acc`, index: 0, label: 'Account 1' }],
    createdAt: 0,
  } as unknown as Wallet
}

function adapter(read: () => WalletStorage) {
  const set = vi.fn(async () => {})
  const get = vi.fn(async () => structuredClone(read()))
  return { get, set, adapter: { get, set } as unknown as StorageAdapter }
}

describe('WalletService.getSnapshot', () => {
  it('derives all three values from one storage read', async () => {
    const data: WalletStorage = {
      wallets: [wallet('z1a', 'a'), wallet('z1b', 'b')],
      activeWalletAddress: 'z1b',
      activeAccountAddress: 'z1b-acc',
    }
    const { get, adapter: storage } = adapter(() => data)

    const snapshot = await new WalletService(storage).getSnapshot()

    expect(get).toHaveBeenCalledTimes(1)
    expect(snapshot.wallets).toHaveLength(2)
    expect(snapshot.activeWallet?.baseAddress).toBe('z1b')
    expect(snapshot.activeAccount).toBe('z1b-acc')
  })

  it('returns empty values for empty storage', async () => {
    const storage = { get: async () => null, set: async () => {} } as unknown as StorageAdapter

    expect(await new WalletService(storage).getSnapshot()).toEqual({
      wallets: [],
      activeWallet: null,
      activeAccount: null,
    })
  })
})

describe('WalletService.unlockWallet key file upgrade', () => {
  it('patches only the unlocked wallet on top of storage as it is after the encrypt', async () => {
    let current: WalletStorage = {
      wallets: [wallet('z1a', 'old-a'), wallet('z1b', 'old-b')],
      activeWalletAddress: 'z1a',
      activeAccountAddress: 'z1a-acc',
    }
    const { set, adapter: storage } = adapter(() => current)
    // Another window switches the active wallet while the encrypt runs.
    const read = storage.get as ReturnType<typeof vi.fn>
    read
      .mockImplementationOnce(async () => structuredClone(current))
      .mockImplementationOnce(async () => {
        current = { ...current, activeWalletAddress: 'z1b', activeAccountAddress: 'z1b-acc' }
        return structuredClone(current)
      })

    await new WalletService(storage).unlockWallet('z1a', 'pw')

    expect(set).toHaveBeenCalledTimes(1)
    const saved = (set.mock.calls[0] as unknown as [string, WalletStorage])[1]
    expect(saved.activeWalletAddress).toBe('z1b')
    expect(saved.activeAccountAddress).toBe('z1b-acc')
    expect(saved.wallets[0].encryptedKeyFile).toBe(NEW_KEY_FILE)
    expect(saved.wallets[1].encryptedKeyFile).toBe('old-b')
  })

  it('writes nothing when the wallet was deleted during the encrypt', async () => {
    const first: WalletStorage = {
      wallets: [wallet('z1a', 'old-a')],
      activeWalletAddress: 'z1a',
      activeAccountAddress: 'z1a-acc',
    }
    const { set, adapter: storage } = adapter(() => first)
    const read = storage.get as ReturnType<typeof vi.fn>
    read
      .mockImplementationOnce(async () => structuredClone(first))
      .mockImplementationOnce(async () => ({
        wallets: [],
        activeWalletAddress: null,
        activeAccountAddress: null,
      }))

    await new WalletService(storage).unlockWallet('z1a', 'pw')

    expect(set).not.toHaveBeenCalled()
  })

  it('keeps a key file that another window replaced during the encrypt', async () => {
    const first: WalletStorage = {
      wallets: [wallet('z1a', 'old-a')],
      activeWalletAddress: 'z1a',
      activeAccountAddress: 'z1a-acc',
    }
    const reimported: WalletStorage = {
      ...first,
      wallets: [wallet('z1a', 'reimported-a')],
    }
    const { set, adapter: storage } = adapter(() => first)
    const read = storage.get as ReturnType<typeof vi.fn>
    read
      .mockImplementationOnce(async () => structuredClone(first))
      .mockImplementationOnce(async () => structuredClone(reimported))

    await new WalletService(storage).unlockWallet('z1a', 'pw')

    expect(set).not.toHaveBeenCalled()
  })
})

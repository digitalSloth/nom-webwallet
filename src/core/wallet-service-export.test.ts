import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, WalletStorage } from '@/types'

const decrypt = vi.fn()
const getKeyStore = vi.fn()

vi.mock('znn-typescript-sdk', () => ({
  KeyStore: {},
  KeyFile: { setPassword: () => ({ decrypt }), needsUpgrade: () => false },
}))
vi.mock('@/core/session-manager', () => ({
  sessionManager: { unlock: vi.fn(), getKeyStore },
}))

const { WalletService } = await import('@/core/wallet-service')

const ADDRESS = 'z1wallet'
const stored: WalletStorage = {
  wallets: [
    {
      name: 'Main',
      baseAddress: ADDRESS,
      encryptedKeyFile: { file: true },
      accounts: [],
      createdAt: 0,
    },
  ],
  activeWalletAddress: ADDRESS,
  activeAccountAddress: null,
} as unknown as WalletStorage

function service() {
  const storage = { get: vi.fn(async () => structuredClone(stored)), set: vi.fn() }
  return new WalletService(storage as unknown as StorageAdapter)
}

beforeEach(() => {
  vi.clearAllMocks()
  decrypt.mockImplementation(async () => {
    throw new Error('bad password')
  })
})

describe('WalletService.exportMnemonicWithPassword', () => {
  it('returns the mnemonic from the decrypted key file for the right password', async () => {
    decrypt.mockResolvedValueOnce({ mnemonic: 'word '.repeat(23) + 'last' })

    await expect(service().exportMnemonicWithPassword(ADDRESS, 'pw')).resolves.toBe(
      'word '.repeat(23) + 'last'
    )
  })

  it('never reads the session, even for an unlocked wallet', async () => {
    getKeyStore.mockReturnValue({ mnemonic: 'from the session' })
    decrypt.mockResolvedValueOnce({ mnemonic: 'from the key file' })

    const mnemonic = await service().exportMnemonicWithPassword(ADDRESS, 'pw')

    expect(mnemonic).toBe('from the key file')
    expect(getKeyStore).not.toHaveBeenCalled()
  })

  it('rejects a wrong password', async () => {
    getKeyStore.mockReturnValue({ mnemonic: 'from the session' })

    await expect(service().exportMnemonicWithPassword(ADDRESS, 'wrong')).rejects.toThrow(
      'Invalid password'
    )
  })

  it('counts wrong passwords against the unlock backoff', async () => {
    const wallets = service()
    for (let i = 0; i < 5; i++) {
      await expect(wallets.exportMnemonicWithPassword(ADDRESS, 'wrong')).rejects.toThrow(
        'Invalid password'
      )
    }

    await expect(wallets.exportMnemonicWithPassword(ADDRESS, 'wrong')).rejects.toThrow(
      /Too many attempts/
    )
    await expect(wallets.unlockWallet(ADDRESS, 'wrong')).rejects.toThrow(/Too many attempts/)
  })

  it('resets the failed attempt count after the right password', async () => {
    const wallets = service()
    for (let i = 0; i < 4; i++) {
      await expect(wallets.exportMnemonicWithPassword(ADDRESS, 'wrong')).rejects.toThrow(
        'Invalid password'
      )
    }
    decrypt.mockResolvedValueOnce({ mnemonic: 'ok' })
    await wallets.exportMnemonicWithPassword(ADDRESS, 'pw')

    for (let i = 0; i < 4; i++) {
      await expect(wallets.exportMnemonicWithPassword(ADDRESS, 'wrong')).rejects.toThrow(
        'Invalid password'
      )
    }
  })

  it('rejects an unknown wallet', async () => {
    await expect(service().exportMnemonicWithPassword('z1other', 'pw')).rejects.toThrow(
      'Wallet not found'
    )
  })
})

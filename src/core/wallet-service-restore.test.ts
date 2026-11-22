import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, WalletStorage } from '@/types'

const encryptSpy = vi.fn()
const decryptSpy = vi.fn()
const fromMnemonic = vi.fn()
const strength = vi.fn()
const unlockSpy = vi.fn()

vi.mock('znn-typescript-sdk', () => ({
  KeyStore: {
    fromMnemonic: (...args: unknown[]) => fromMnemonic(...args),
    newRandom: vi.fn(),
  },
  KeyFile: {
    setPassword: (password: string) => ({
      decrypt: async (file: { password: string }) => {
        decryptSpy(password, file)
        if (file.password !== password) throw new Error('bad password')
        return { entropy: 'secret' }
      },
      encrypt: async (keyStore: unknown, config: unknown) => {
        encryptSpy(password, keyStore, config)
        return { password, v: 'restored' }
      },
    }),
    needsUpgrade: () => false,
  },
}))
vi.mock('@/core/session-manager', () => ({
  sessionManager: { unlock: unlockSpy },
}))
vi.mock('@/core/password-strength', () => ({ estimatePasswordStrength: strength }))

const { WalletService } = await import('@/core/wallet-service')

const MAIN = 'z1main'
const OTHER = 'z1other'
const OLD = 'old-password'
const NEXT = 'next-password'
const PHRASE = 'some phrase'
const CHANGED = 'This wallet changed in another window. Try again.'

function makeKeyStore(address: string) {
  return { getBaseAddress: () => ({ toString: () => address }), tag: address }
}

function makeStored(): WalletStorage {
  return {
    wallets: [
      {
        name: 'Main',
        baseAddress: MAIN,
        encryptedKeyFile: { password: OLD, v: 'old' },
        accounts: [
          { address: MAIN, index: 0, label: 'Spending' },
          { address: 'z1main2', index: 1, label: 'Savings', hidden: true },
        ],
        createdAt: 1,
      },
      {
        name: 'Other',
        baseAddress: OTHER,
        encryptedKeyFile: { password: 'x', v: 'other' },
        accounts: [{ address: OTHER, index: 0 }],
        createdAt: 2,
      },
    ],
    activeWalletAddress: OTHER,
    activeAccountAddress: OTHER,
  } as unknown as WalletStorage
}

let current: WalletStorage
let reads: (() => WalletStorage | null)[]
let storage: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
let service: InstanceType<typeof WalletService>

beforeEach(() => {
  vi.clearAllMocks()
  strength.mockResolvedValue({ meetsFloor: true })
  fromMnemonic.mockReturnValue(makeKeyStore(MAIN))
  current = makeStored()
  reads = []
  storage = {
    get: vi.fn(async () => {
      const next = reads.shift()
      return next ? next() : structuredClone(current)
    }),
    set: vi.fn(async (_key: string, value: WalletStorage) => {
      current = structuredClone(value)
    }),
  }
  service = new WalletService(storage as unknown as StorageAdapter)
})

describe('WalletService.restoreWallet for an existing wallet', () => {
  it('replaces only that wallet key file and keeps everything else', async () => {
    await service.restoreWallet(PHRASE, NEXT)

    const expected = makeStored()
    expected.wallets[0].encryptedKeyFile = { password: NEXT, v: 'restored' } as never
    expected.activeWalletAddress = MAIN
    expected.activeAccountAddress = MAIN
    expect(current).toEqual(expected)
    expect(current.wallets).toHaveLength(2)
  })

  it('unlocks the wallet with the derived key store', async () => {
    await service.restoreWallet(PHRASE, NEXT)

    expect(unlockSpy).toHaveBeenCalledWith(MAIN, expect.objectContaining({ tag: MAIN }))
  })

  it('makes a non-active wallet active with its first account', async () => {
    await service.restoreWallet(PHRASE, NEXT)

    expect(current.activeWalletAddress).toBe(MAIN)
    expect(current.activeAccountAddress).toBe(MAIN)
  })

  it('keeps the active account when the wallet is already active', async () => {
    current.activeWalletAddress = MAIN
    current.activeAccountAddress = 'z1main2'

    await service.restoreWallet(PHRASE, NEXT)

    expect(current.activeWalletAddress).toBe(MAIN)
    expect(current.activeAccountAddress).toBe('z1main2')
  })

  it('clears the failed-attempt count so the next unlock decrypts', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(service.unlockWallet(MAIN, 'wrong')).rejects.toThrow()
    }
    await expect(service.unlockWallet(MAIN, OLD)).rejects.toThrow('Too many attempts')

    await service.restoreWallet(PHRASE, NEXT)

    await expect(service.unlockWallet(MAIN, NEXT)).resolves.toBeUndefined()
  })

  it('finds the target only by the base address the phrase derives', async () => {
    fromMnemonic.mockReturnValue(makeKeyStore(OTHER))

    await service.restoreWallet(PHRASE, NEXT)

    expect(current.wallets[0].encryptedKeyFile).toEqual({ password: OLD, v: 'old' })
    expect(current.wallets[1].encryptedKeyFile).toEqual({ password: NEXT, v: 'restored' })
  })

  it('throws when the wallet was removed during the encrypt, with no write', async () => {
    reads = [
      () => makeStored(),
      () => {
        const gone = makeStored()
        gone.wallets = gone.wallets.slice(1)
        return gone
      },
    ]

    await expect(service.restoreWallet(PHRASE, NEXT)).rejects.toThrow(CHANGED)
    expect(storage.set).not.toHaveBeenCalled()
    expect(unlockSpy).not.toHaveBeenCalled()
  })

  it('throws and does not unlock when the post-write read shows another key file', async () => {
    storage.set.mockImplementation(async () => {
      current = makeStored()
    })

    await expect(service.restoreWallet(PHRASE, NEXT)).rejects.toThrow(CHANGED)
    expect(unlockSpy).not.toHaveBeenCalled()
  })

  it('throws and does not unlock when the wallet vanished after the write', async () => {
    storage.set.mockImplementation(async (_k: string, value: WalletStorage) => {
      current = structuredClone(value)
      current.wallets = current.wallets.slice(1)
    })

    await expect(service.restoreWallet(PHRASE, NEXT)).rejects.toThrow(CHANGED)
    expect(unlockSpy).not.toHaveBeenCalled()
  })

  it('is not undone by a rename that read the storage before the restore', async () => {
    await service.restoreWallet(PHRASE, NEXT)
    const restored = structuredClone(current.wallets[0].encryptedKeyFile)
    reads = [() => makeStored()]

    await service.renameWallet(MAIN, 'Renamed')

    expect(current.wallets[0].name).toBe('Renamed')
    expect(current.wallets[0].encryptedKeyFile).toEqual(restored)
  })
})

describe('WalletService.restoreWallet for a new wallet', () => {
  beforeEach(() => fromMnemonic.mockReturnValue(makeKeyStore('z1new')))

  it('appends it like an import with the default name and makes it active', async () => {
    const wallet = await service.restoreWallet(PHRASE, NEXT)

    expect(wallet.name).toBe('Imported Wallet')
    expect(current.wallets).toHaveLength(3)
    expect(current.wallets[2].baseAddress).toBe('z1new')
    expect(current.activeWalletAddress).toBe('z1new')
    expect(unlockSpy).toHaveBeenCalledWith('z1new', expect.anything())
  })

  it('uses the given name', async () => {
    expect((await service.restoreWallet(PHRASE, NEXT, 'Mine')).name).toBe('Mine')
  })

  it('works with no stored wallets', async () => {
    current = undefined as never
    storage.get.mockResolvedValue(null)

    const wallet = await service.restoreWallet(PHRASE, NEXT)

    expect(wallet.baseAddress).toBe('z1new')
    expect(current.wallets).toHaveLength(1)
  })
})

describe('WalletService.restoreWallet failures', () => {
  it('rejects a weak password before deriving the key or writing', async () => {
    strength.mockResolvedValue({ meetsFloor: false })

    await expect(service.restoreWallet(PHRASE, 'weak')).rejects.toThrow(
      'Please choose a stronger password'
    )
    expect(fromMnemonic).not.toHaveBeenCalled()
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('rejects when the phrase cannot be derived, with no write and no unlock', async () => {
    fromMnemonic.mockImplementation(() => {
      throw new Error('bad phrase')
    })

    await expect(service.restoreWallet(PHRASE, NEXT)).rejects.toThrow('bad phrase')
    expect(storage.set).not.toHaveBeenCalled()
    expect(unlockSpy).not.toHaveBeenCalled()
  })
})

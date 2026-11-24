import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageAdapter, WalletStorage } from '@/types'
import { KDF_CONFIG } from '@/config'

// The fake key file records the password it was encrypted under.
const encryptSpy = vi.fn()
const decryptSpy = vi.fn()
const strength = vi.fn()
const sessionCalls = vi.fn()

vi.mock('znn-typescript-sdk', () => ({
  KeyStore: {},
  KeyFile: {
    setPassword: (password: string) => ({
      decrypt: async (file: { password: string }) => {
        decryptSpy(password, file)
        if (file.password !== password) throw new Error('bad password')
        return { entropy: 'secret' }
      },
      encrypt: async (keyStore: unknown, config: unknown) => {
        encryptSpy(password, keyStore, config)
        return { password, v: 'new' }
      },
    }),
    needsUpgrade: () => false,
  },
}))
vi.mock('@/core/session-manager', () => ({
  sessionManager: new Proxy({}, { get: () => sessionCalls }),
}))
vi.mock('@/core/password-strength', () => ({ estimatePasswordStrength: strength }))

const { WalletService } = await import('@/core/wallet-service')

const ADDRESS = 'z1wallet'
const OLD = 'old-password'
const NEXT = 'next-password'

function makeStored(): WalletStorage {
  return {
    wallets: [
      {
        name: 'Main',
        baseAddress: ADDRESS,
        encryptedKeyFile: { password: OLD, v: 'old' },
        accounts: [{ address: ADDRESS, index: 0 }],
        createdAt: 1,
      },
      {
        name: 'Other',
        baseAddress: 'z1other',
        encryptedKeyFile: { password: 'x', v: 'other' },
        accounts: [],
        createdAt: 2,
      },
    ],
    activeWalletAddress: ADDRESS,
    activeAccountAddress: ADDRESS,
  } as unknown as WalletStorage
}

let current: WalletStorage
let reads: (() => WalletStorage | null)[]
let storage: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
let service: InstanceType<typeof WalletService>

beforeEach(() => {
  vi.clearAllMocks()
  strength.mockResolvedValue({ meetsFloor: true })
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

describe('WalletService.changePassword', () => {
  it('re-encrypts only that wallet key file with the new password and KDF_CONFIG', async () => {
    await service.changePassword(ADDRESS, OLD, NEXT)

    expect(encryptSpy).toHaveBeenCalledWith(NEXT, { entropy: 'secret' }, KDF_CONFIG)
    expect(storage.set).toHaveBeenCalledTimes(1)
    const expected = makeStored()
    expected.wallets[0].encryptedKeyFile = { password: NEXT, v: 'new' } as never
    expect(current).toEqual(expected)
  })

  it('writes a key file that opens with the new password and not the old one', async () => {
    await service.changePassword(ADDRESS, OLD, NEXT)
    const file = current.wallets[0].encryptedKeyFile as unknown as { password: string }
    const { KeyFile } = await import('znn-typescript-sdk')

    await expect(KeyFile.setPassword(NEXT).decrypt(file as never)).resolves.toBeTruthy()
    await expect(KeyFile.setPassword(OLD).decrypt(file as never)).rejects.toThrow()
  })

  it('refuses the write when another window replaced the key file', async () => {
    reads = [
      () => makeStored(),
      () => {
        const changed = makeStored()
        changed.wallets[0].encryptedKeyFile = { password: 'elsewhere', v: 'e' } as never
        return changed
      },
    ]

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow(
      'This wallet changed in another window. Try again.'
    )
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('fails when another document overwrites the storage with the old key file right after the write', async () => {
    storage.set.mockImplementation(async () => {
      // The stale copy wins: storage keeps the old key file.
      current = makeStored()
    })

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow(
      'This wallet changed in another window. Try again.'
    )
  })

  it('keeps the new key file when a stale copy is written by a non-keyfile operation', async () => {
    await service.changePassword(ADDRESS, OLD, NEXT)
    const changed = structuredClone(current.wallets[0].encryptedKeyFile)
    // A rename that loaded the storage before the password change.
    reads = [() => makeStored()]

    await service.renameWallet(ADDRESS, 'Renamed')

    expect(current.wallets[0].name).toBe('Renamed')
    expect(current.wallets[0].encryptedKeyFile).toEqual(changed)
    expect(current.wallets[0].encryptedKeyFile).not.toEqual({ password: OLD, v: 'old' })
  })

  it.each<[string, () => Promise<unknown>]>([
    ['renameWallet', () => service.renameWallet(ADDRESS, 'Renamed')],
    ['renameAccount', () => service.renameAccount(ADDRESS, ADDRESS, 'Label')],
    ['setAccountHidden', () => service.setAccountHidden(ADDRESS, ADDRESS, false)],
    ['setActiveWallet', () => service.setActiveWallet('z1other')],
    ['setActiveAccount', () => service.setActiveAccount(ADDRESS)],
    ['deleteWallet', () => service.deleteWallet('z1other')],
    [
      'deriveAccount',
      () => {
        sessionCalls.mockReturnValueOnce({
          getKeyPair: () => ({ getAddress: () => ({ toString: () => 'z1derived' }) }),
        })
        return service.deriveAccount(ADDRESS)
      },
    ],
  ])('%s keeps the stored key file when it works from a stale copy', async (_name, write) => {
    await service.changePassword(ADDRESS, OLD, NEXT)
    const changed = structuredClone(current.wallets[0].encryptedKeyFile)
    reads = [() => makeStored()]

    await write()

    expect(storage.set).toHaveBeenCalledTimes(2)
    expect(current.wallets[0].encryptedKeyFile).toEqual(changed)
    expect(current.wallets[0].encryptedKeyFile).not.toEqual({ password: OLD, v: 'old' })
  })

  it('refuses a password change that a stale full write undid after the write', async () => {
    storage.set.mockImplementation(async (_key: string, value: WalletStorage) => {
      current = structuredClone(value)
      // Another document writes its older copy right after.
      current = makeStored()
    })

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow(
      'This wallet changed in another window. Try again.'
    )
  })

  it('refuses a password change when the wallet vanished right after the write', async () => {
    storage.set.mockImplementation(async (_key: string, value: WalletStorage) => {
      current = structuredClone(value)
      current.wallets = current.wallets.slice(1)
    })

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow(
      'This wallet changed in another window. Try again.'
    )
  })

  it('refuses the write when the wallet was removed meanwhile', async () => {
    reads = [
      () => makeStored(),
      () => {
        const changed = makeStored()
        changed.wallets = changed.wallets.slice(1)
        return changed
      },
    ]

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow(
      'This wallet changed in another window. Try again.'
    )
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password and writes nothing', async () => {
    await expect(service.changePassword(ADDRESS, 'wrong', NEXT)).rejects.toThrow(
      'Invalid password'
    )
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('locks out after 5 wrong passwords, for changePassword and unlockWallet', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(service.changePassword(ADDRESS, 'wrong', NEXT)).rejects.toThrow(
        'Invalid password'
      )
    }

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow('Too many attempts')
    await expect(service.unlockWallet(ADDRESS, OLD)).rejects.toThrow('Too many attempts')
    expect(storage.set).not.toHaveBeenCalled()
  })

  it('counts failures from unlockWallet toward the same lockout', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(service.unlockWallet(ADDRESS, 'wrong')).rejects.toThrow()
    }

    await expect(service.changePassword(ADDRESS, OLD, NEXT)).rejects.toThrow('Too many attempts')
  })

  it('resets the failure count after a success', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(service.changePassword(ADDRESS, 'wrong', NEXT)).rejects.toThrow()
    }
    await service.changePassword(ADDRESS, OLD, NEXT)

    for (let i = 0; i < 4; i++) {
      await expect(service.changePassword(ADDRESS, 'wrong', 'another-password')).rejects.toThrow(
        'Invalid password'
      )
    }
  })

  it('rejects a new password equal to the current one without counting an attempt', async () => {
    for (let i = 0; i < 6; i++) {
      await expect(service.changePassword(ADDRESS, OLD, OLD)).rejects.toThrow(
        'The new password must differ from the current one'
      )
    }

    expect(decryptSpy).not.toHaveBeenCalled()
    await service.changePassword(ADDRESS, OLD, NEXT)
  })

  it('rejects a weak new password without decrypting or counting an attempt', async () => {
    strength.mockResolvedValue({ meetsFloor: false })

    for (let i = 0; i < 6; i++) {
      await expect(service.changePassword(ADDRESS, OLD, 'abc')).rejects.toThrow(
        'Please choose a stronger password'
      )
    }

    expect(decryptSpy).not.toHaveBeenCalled()
    strength.mockResolvedValue({ meetsFloor: true })
    await service.changePassword(ADDRESS, OLD, NEXT)
  })

  it('rejects an unknown wallet', async () => {
    await expect(service.changePassword('z1missing', OLD, NEXT)).rejects.toThrow(
      'Wallet not found'
    )
  })

  it('never touches the session manager', async () => {
    await service.changePassword(ADDRESS, OLD, NEXT)
    await expect(service.changePassword(ADDRESS, 'wrong', 'third-password')).rejects.toThrow()

    expect(sessionCalls).not.toHaveBeenCalled()
  })
})

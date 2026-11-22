import {KeyFile, KeyStore} from 'znn-typescript-sdk'
import type {StorageAdapter, Wallet, WalletAccount, WalletStorage} from '@/types'
import {KDF_CONFIG, STORAGE_KEY_WALLETS as STORAGE_KEY} from '@/config'
import {sessionManager} from './session-manager'
import {estimatePasswordStrength} from './password-strength'
import {storageService} from './storage/storage-service'
import {Buffer} from 'buffer'

const MAX_UNLOCK_ATTEMPTS = 5
const BASE_LOCKOUT_MS = 5_000 // 5 seconds after 5th failed attempt

interface FailedAttempt {
  count: number
  lastAttemptAt: number
}

export class WalletService {
  private failedAttempts = new Map<string, FailedAttempt>()
  private static instance: WalletService | null = null

  constructor(private storage: StorageAdapter = storageService) {}

  // Singleton accessor. Uses the auto-detecting storageService so the correct
  // adapter (localStorage vs chrome.storage) is selected per environment.
  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService(storageService)
    }
    return WalletService.instance
  }

  // Get active account address
  async getActiveAccount(): Promise<string | null> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    return data?.activeAccountAddress ?? null
  }

  // Read the wallet list, active wallet and active account from one storage
  // read, so the three values always describe the same state.
  async getSnapshot(): Promise<{
    wallets: Wallet[]
    activeWallet: Wallet | null
    activeAccount: string | null
  }> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    return {
      wallets: data?.wallets ?? [],
      activeWallet: data?.wallets.find((w) => w.baseAddress === data.activeWalletAddress) ?? null,
      activeAccount: data?.activeAccountAddress ?? null,
    }
  }

  // Import wallet from mnemonic
  async importWallet(mnemonic: string, password: string, name?: string): Promise<Wallet> {
    const keyStore = KeyStore.fromMnemonic(mnemonic)
    return await this.saveWallet(keyStore, password, name || 'Imported Wallet')
  }

  // Imports a phrase, or, when a wallet with the phrase's base address exists,
  // replaces that wallet's key file under the new password. The target is found
  // only by the base address the phrase derives, so a key file cannot be
  // replaced without that wallet's phrase.
  async restoreWallet(mnemonic: string, password: string, name?: string): Promise<Wallet> {
    if (!(await estimatePasswordStrength(password)).meetsFloor) {
      throw new Error('Please choose a stronger password')
    }

    const keyStore = KeyStore.fromMnemonic(mnemonic)
    const baseAddress = keyStore.getBaseAddress().toString()

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data?.wallets.some((w) => w.baseAddress === baseAddress)) {
      return await this.saveWallet(keyStore, password, name || 'Imported Wallet')
    }

    const encrypted = await KeyFile.setPassword(password).encrypt(keyStore, KDF_CONFIG)

    const latest = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const target = latest?.wallets.find((w) => w.baseAddress === baseAddress)
    if (!latest || !target) throw new Error('This wallet changed in another window. Try again.')

    target.encryptedKeyFile = encrypted
    if (latest.activeWalletAddress !== baseAddress) {
      latest.activeWalletAddress = baseAddress
      latest.activeAccountAddress = target.accounts[0]?.address ?? null
    }
    // Not writeKeepingKeyFiles: it would put the old key file back.
    await this.storage.set(STORAGE_KEY, latest)

    const written = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const saved = written?.wallets.find((w) => w.baseAddress === baseAddress)
    if (!saved || JSON.stringify(saved.encryptedKeyFile) !== JSON.stringify(encrypted)) {
      throw new Error('This wallet changed in another window. Try again.')
    }

    this.failedAttempts.delete(baseAddress)
    sessionManager.unlock(baseAddress, keyStore)
    return target
  }

  // Shared logic for saving a wallet
  private async saveWallet(keyStore: KeyStore, password: string, name: string): Promise<Wallet> {
    const keyFile = KeyFile.setPassword(password)
    // Encrypt with strong KDF params; the SDK persists them in the keyfile.
    const encryptedKeyFile = await keyFile.encrypt(keyStore, KDF_CONFIG)

    // Create base account (index 0)
    const baseAccount: WalletAccount = {
      address: keyStore.getBaseAddress().toString(),
      index: 0,
      label: 'Account 1',
    }

    const wallet: Wallet = {
      name,
      baseAddress: keyStore.getBaseAddress().toString(),
      encryptedKeyFile,
      accounts: [baseAccount],
      createdAt: Date.now(),
    }

    // Store wallet
    const data = (await this.storage.get<WalletStorage>(STORAGE_KEY)) ?? {
      wallets: [],
      activeWalletAddress: null,
      activeAccountAddress: null,
    }

    data.wallets.push(wallet)
    data.activeWalletAddress = wallet.baseAddress
    data.activeAccountAddress = baseAccount.address

    await this.storage.set(STORAGE_KEY, data)

    // Unlock the wallet immediately
    sessionManager.unlock(wallet.baseAddress, keyStore)

    return wallet
  }

  // Unlock wallet with password
  async unlockWallet(address: string, password: string): Promise<void> {
    this.assertNotLockedOut(address)

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const wallet = data?.wallets.find((w) => w.baseAddress === address)

    if (!wallet) {
      throw new Error('Wallet not found')
    }

    try {
      const keyFile = KeyFile.setPassword(password)
      // The keyfile is self-describing: decrypt reads its stored KDF params
      // (or falls back to the SDK's legacy DEFAULT_CONFIG for older keyfiles).
      const keyStore = await keyFile.decrypt(wallet.encryptedKeyFile)

      this.failedAttempts.delete(address)
      sessionManager.unlock(address, keyStore)

      // Upgrade-on-unlock: transparently re-encrypt wallets whose KDF params are
      // weaker than our target. Best-effort — a failure here must never block
      // the unlock.
      if (KeyFile.needsUpgrade(wallet.encryptedKeyFile, KDF_CONFIG)) {
        try {
          const upgraded = await keyFile.encrypt(keyStore, KDF_CONFIG)
          // Re-read after the slow encrypt and patch only this wallet's
          // keyfile, so a change another window saved meanwhile survives.
          // A key file that differs from the decrypted one was replaced (a
          // delete and re-import), and stays.
          const latest = await this.storage.get<WalletStorage>(STORAGE_KEY)
          const target = latest?.wallets.find((w) => w.baseAddress === address)
          if (
            latest &&
            target &&
            JSON.stringify(target.encryptedKeyFile) === JSON.stringify(wallet.encryptedKeyFile)
          ) {
            target.encryptedKeyFile = upgraded
            await this.storage.set(STORAGE_KEY, latest)
          }
        } catch (err) {
          console.error('Failed to upgrade wallet KDF on unlock:', err)
        }
      }
    } catch {
      this.recordFailedAttempt(address)
      throw new Error('Invalid password')
    }
  }

  // Writes the wallet storage for operations that do not change a key file.
  // Only changePassword, restoreWallet, the KDF upgrade on unlock and saveWallet
  // may write `encryptedKeyFile`. This re-reads the storage right before the write and
  // keeps each wallet's stored key file, so a copy loaded before another
  // document changed the password cannot bring the old key file back.
  private async writeKeepingKeyFiles(data: WalletStorage): Promise<void> {
    const latest = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (latest) {
      for (const wallet of data.wallets) {
        const stored = latest.wallets.find((w) => w.baseAddress === wallet.baseAddress)
        if (stored) wallet.encryptedKeyFile = stored.encryptedKeyFile
      }
    }
    await this.storage.set(STORAGE_KEY, data)
  }

  private assertNotLockedOut(address: string): void {
    const failed = this.failedAttempts.get(address)

    if (failed && failed.count >= MAX_UNLOCK_ATTEMPTS) {
      const lockoutMs = BASE_LOCKOUT_MS * 2 ** (failed.count - MAX_UNLOCK_ATTEMPTS)
      const elapsed = Date.now() - failed.lastAttemptAt

      if (elapsed < lockoutMs) {
        const remainingSec = Math.ceil((lockoutMs - elapsed) / 1000)
        throw new Error(`Too many attempts. Try again in ${remainingSec} seconds.`)
      }
    }
  }

  private recordFailedAttempt(address: string): void {
    const current = this.failedAttempts.get(address) ?? { count: 0, lastAttemptAt: 0 }
    this.failedAttempts.set(address, {
      count: current.count + 1,
      lastAttemptAt: Date.now(),
    })
  }

  // Lock wallet
  lockWallet(address: string): void {
    sessionManager.lock(address)
  }

  // Lock all wallets
  lockAll(): void {
    sessionManager.lockAll()
  }

  // Check if wallet is unlocked
  isWalletUnlocked(address: string): boolean {
    return sessionManager.isUnlocked(address)
  }

  // Derive new account
  async deriveAccount(walletAddress: string, label?: string): Promise<WalletAccount> {
    const keyStore = sessionManager.getKeyStore(walletAddress)
    if (!keyStore) {
      throw new Error('Wallet is locked')
    }

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const wallet = data?.wallets.find((w) => w.baseAddress === walletAddress)

    if (!wallet) {
      throw new Error('Wallet not found')
    }

    // Find next available index
    const maxIndex = wallet.accounts.reduce((max, acc) => Math.max(max, acc.index), -1)
    const newIndex = maxIndex + 1

    // Derive new keypair
    const keyPair = keyStore.getKeyPair(newIndex)
    const newAccount: WalletAccount = {
      address: keyPair.getAddress().toString(),
      index: newIndex,
      label: label || `Account ${newIndex + 1}`,
    }

    // Update wallet
    wallet.accounts.push(newAccount)
    await this.writeKeepingKeyFiles(data!)

    return newAccount
  }

  // Export the mnemonic of a wallet after decrypting its stored key file with
  // the password. The session is never read, so a wallet that is unlocked
  // (possibly by another extension document) still needs the password. Wrong
  // passwords count against the same backoff as unlockWallet.
  async exportMnemonicWithPassword(address: string, password: string): Promise<string> {
    this.assertNotLockedOut(address)

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const wallet = data?.wallets.find((w) => w.baseAddress === address)

    if (!wallet) {
      throw new Error('Wallet not found')
    }

    try {
      const keyStore = await KeyFile.setPassword(password).decrypt(wallet.encryptedKeyFile)
      this.failedAttempts.delete(address)
      return keyStore.mnemonic
    } catch {
      this.recordFailedAttempt(address)
      throw new Error('Invalid password')
    }
  }

  // Re-encrypt a wallet's key file under a new password. The key does not
  // change, so unlocked sessions stay valid. Only this wallet's keyfile is
  // replaced, and only if it is still the one that was decrypted.
  async changePassword(address: string, current: string, next: string): Promise<void> {
    this.assertNotLockedOut(address)

    if (next === current) throw new Error('The new password must differ from the current one')
    if (!(await estimatePasswordStrength(next)).meetsFloor) {
      throw new Error('Please choose a stronger password')
    }

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const wallet = data?.wallets.find((w) => w.baseAddress === address)
    if (!wallet) throw new Error('Wallet not found')

    let keyStore: KeyStore
    try {
      keyStore = await KeyFile.setPassword(current).decrypt(wallet.encryptedKeyFile)
    } catch {
      this.recordFailedAttempt(address)
      throw new Error('Invalid password')
    }
    this.failedAttempts.delete(address)

    const encrypted = await KeyFile.setPassword(next).encrypt(keyStore, KDF_CONFIG)

    const latest = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const target = latest?.wallets.find((w) => w.baseAddress === address)
    if (
      !latest ||
      !target ||
      JSON.stringify(target.encryptedKeyFile) !== JSON.stringify(wallet.encryptedKeyFile)
    ) {
      throw new Error('This wallet changed in another window. Try again.')
    }
    target.encryptedKeyFile = encrypted
    await this.storage.set(STORAGE_KEY, latest)

    // Another document may have written its older copy of the storage between
    // the re-read and the write, which would restore the old-password keyfile.
    const written = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const saved = written?.wallets.find((w) => w.baseAddress === address)
    if (!saved || JSON.stringify(saved.encryptedKeyFile) !== JSON.stringify(encrypted)) {
      throw new Error('This wallet changed in another window. Try again.')
    }
  }

  // Rename wallet
  async renameWallet(address: string, newName: string): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    const wallet = data.wallets.find((w) => w.baseAddress === address)
    if (!wallet) throw new Error('Wallet not found')

    wallet.name = newName
    await this.writeKeepingKeyFiles(data)
  }

  // Rename account
  async renameAccount(
    walletAddress: string,
    accountAddress: string,
    newLabel: string
  ): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    const wallet = data.wallets.find((w) => w.baseAddress === walletAddress)
    if (!wallet) throw new Error('Wallet not found')

    const account = wallet.accounts.find((a) => a.address === accountAddress)
    if (!account) throw new Error('Account not found')

    account.label = newLabel
    await this.writeKeepingKeyFiles(data)
  }

  // Hide / show account
  async setAccountHidden(
    walletAddress: string,
    accountAddress: string,
    hidden: boolean
  ): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    const wallet = data.wallets.find((w) => w.baseAddress === walletAddress)
    if (!wallet) throw new Error('Wallet not found')

    const account = wallet.accounts.find((a) => a.address === accountAddress)
    if (!account) throw new Error('Account not found')

    if (hidden) {
      const visibleCount = wallet.accounts.filter((a) => !a.hidden).length
      const wouldBeVisible = account.hidden ? visibleCount : visibleCount - 1
      if (wouldBeVisible < 1) {
        throw new Error('Cannot hide the last visible account')
      }
    }

    account.hidden = hidden

    if (hidden && data.activeAccountAddress === accountAddress) {
      const nextVisible = [...wallet.accounts]
        .filter((a) => !a.hidden)
        .sort((a, b) => a.index - b.index)[0]
      data.activeAccountAddress = nextVisible?.address ?? null
    }

    await this.writeKeepingKeyFiles(data)
  }

  // Delete wallet
  async deleteWallet(address: string): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) return

    data.wallets = data.wallets.filter((w) => w.baseAddress !== address)

    // Update active wallet if deleted
    if (data.activeWalletAddress === address) {
      data.activeWalletAddress = data.wallets[0]?.baseAddress ?? null
      data.activeAccountAddress = data.wallets[0]?.accounts[0]?.address ?? null
    }

    await this.writeKeepingKeyFiles(data)

    // Lock the wallet session
    sessionManager.lock(address)
  }

  // Set active wallet
  async setActiveWallet(address: string): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    const wallet = data.wallets.find((w) => w.baseAddress === address)
    if (!wallet) throw new Error('Wallet not found')

    data.activeWalletAddress = address
    data.activeAccountAddress = wallet.accounts[0]?.address ?? null

    await this.writeKeepingKeyFiles(data)
  }

  // Set active account
  async setActiveAccount(accountAddress: string): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    // Find which wallet this account belongs to
    let found = false
    for (const wallet of data.wallets) {
      if (wallet.accounts.some((acc) => acc.address === accountAddress)) {
        data.activeWalletAddress = wallet.baseAddress
        data.activeAccountAddress = accountAddress
        found = true
        break
      }
    }

    if (!found) {
      throw new Error('Account not found')
    }

    await this.writeKeepingKeyFiles(data)
  }

  // Sign data with account
  async signData(accountAddress: string, data: Buffer): Promise<Buffer> {
    // Find wallet and account
    const wallets = sessionManager.getUnlockedAddresses()

    for (const walletAddress of wallets) {
      const keyStore = sessionManager.getKeyStore(walletAddress)
      if (!keyStore) continue

      // Try to find the account in this wallet
      const storage = await this.storage.get<WalletStorage>(STORAGE_KEY)
      const wallet = storage?.wallets.find((w) => w.baseAddress === walletAddress)
      if (!wallet) continue

      const account = wallet.accounts.find((acc) => acc.address === accountAddress)
      if (account) {
        const keyPair = keyStore.getKeyPair(account.index)
        return keyPair.sign(data)
      }
    }

    throw new Error('Account not found or wallet is locked')
  }

  // Get unlocked wallets
  getUnlockedWallets(): string[] {
    return sessionManager.getUnlockedAddresses()
  }
}

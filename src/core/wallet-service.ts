import {KeyFile, KeyStore} from 'znn-typescript-sdk'
import type {StorageAdapter, Wallet, WalletAccount, WalletStorage} from '@/types'
import {sessionManager} from './session-manager'
import {storageService} from './storage/storage-service'
import {Buffer} from 'buffer'

const STORAGE_KEY = 'nom-wallet-storage'

const MAX_UNLOCK_ATTEMPTS = 5
const BASE_LOCKOUT_MS = 5_000 // 5 seconds after 5th failed attempt

interface FailedAttempt {
  count: number
  lastAttemptAt: number
}

export class WalletService {
  private failedAttempts = new Map<string, FailedAttempt>()
  private static instance: WalletService | null = null

  private constructor(private storage: StorageAdapter) {}

  // Singleton accessor. Uses the auto-detecting storageService so the correct
  // adapter (localStorage vs chrome.storage) is selected per environment.
  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService(storageService)
    }
    return WalletService.instance
  }

  // Get all wallets
  async getWallets(): Promise<Wallet[]> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    return data?.wallets ?? []
  }

  // Get active wallet
  async getActiveWallet(): Promise<Wallet | null> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data?.activeWalletAddress) return null

    return data.wallets.find((w) => w.baseAddress === data.activeWalletAddress) ?? null
  }

  // Get active account address
  async getActiveAccount(): Promise<string | null> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    return data?.activeAccountAddress ?? null
  }

  // Create new wallet
  async createWallet(password: string, name?: string): Promise<Wallet> {
    const keyStore = KeyStore.newRandom()
    return await this.saveWallet(keyStore, password, name || 'Wallet 1')
  }

  // Import wallet from mnemonic
  async importWallet(mnemonic: string, password: string, name?: string): Promise<Wallet> {
    const keyStore = KeyStore.fromMnemonic(mnemonic)
    return await this.saveWallet(keyStore, password, name || 'Imported Wallet')
  }

  // Shared logic for saving a wallet
  private async saveWallet(keyStore: KeyStore, password: string, name: string): Promise<Wallet> {
    const keyFile = KeyFile.setPassword(password)
    const encryptedKeyFile = await keyFile.encrypt(keyStore)

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
    const failed = this.failedAttempts.get(address)

    if (failed && failed.count >= MAX_UNLOCK_ATTEMPTS) {
      const lockoutMs = BASE_LOCKOUT_MS * 2 ** (failed.count - MAX_UNLOCK_ATTEMPTS)
      const elapsed = Date.now() - failed.lastAttemptAt

      if (elapsed < lockoutMs) {
        const remainingSec = Math.ceil((lockoutMs - elapsed) / 1000)
        throw new Error(`Too many attempts. Try again in ${remainingSec} seconds.`)
      }
    }

    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    const wallet = data?.wallets.find((w) => w.baseAddress === address)

    if (!wallet) {
      throw new Error('Wallet not found')
    }

    try {
      const keyFile = KeyFile.setPassword(password)
      const keyStore = await keyFile.decrypt(wallet.encryptedKeyFile)

      this.failedAttempts.delete(address)
      sessionManager.unlock(address, keyStore)
    } catch {
      const current = this.failedAttempts.get(address) ?? { count: 0, lastAttemptAt: 0 }
      this.failedAttempts.set(address, {
        count: current.count + 1,
        lastAttemptAt: Date.now(),
      })
      throw new Error('Invalid password')
    }
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
    await this.storage.set(STORAGE_KEY, data!)

    return newAccount
  }

  // Export mnemonic (requires unlocked wallet)
  exportMnemonic(walletAddress: string): string {
    const keyStore = sessionManager.getKeyStore(walletAddress)
    if (!keyStore) {
      throw new Error('Wallet is locked')
    }

    return keyStore.mnemonic
  }

  // Rename wallet
  async renameWallet(address: string, newName: string): Promise<void> {
    const data = await this.storage.get<WalletStorage>(STORAGE_KEY)
    if (!data) throw new Error('No wallet storage found')

    const wallet = data.wallets.find((w) => w.baseAddress === address)
    if (!wallet) throw new Error('Wallet not found')

    wallet.name = newName
    await this.storage.set(STORAGE_KEY, data)
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
    await this.storage.set(STORAGE_KEY, data)
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

    await this.storage.set(STORAGE_KEY, data)
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

    await this.storage.set(STORAGE_KEY, data)

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

    await this.storage.set(STORAGE_KEY, data)
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

    await this.storage.set(STORAGE_KEY, data)
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

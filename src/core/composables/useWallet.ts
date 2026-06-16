import {computed, ref} from 'vue'
import {WalletService} from '../wallet-service'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every useWallet() caller
const wallets = ref<Wallet[]>([])
const activeWallet = ref<Wallet | null>(null)
const activeAccountAddress = ref<string | null>(null)
const unlockedWallets = ref<string[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

// Cached one-time initial load — shared so the router guard and App.vue
// don't each trigger a separate load on startup.
let loadPromise: Promise<void> | null = null

// Computed
const isActiveWalletUnlocked = computed(() => {
  return activeWallet.value ? unlockedWallets.value.includes(activeWallet.value.baseAddress) : false
})

const hasWallets = computed(() => wallets.value.length > 0)

export function useWallet() {
  const walletService = WalletService.getInstance()

  // Load all wallet data
  async function loadWalletData() {
    isLoading.value = true
    error.value = null

    try {
      const [allWallets, active, activeAccount] = await Promise.all([
        walletService.getWallets(),
        walletService.getActiveWallet(),
        walletService.getActiveAccount(),
      ])

      wallets.value = allWallets
      activeWallet.value = active
      activeAccountAddress.value = activeAccount
      unlockedWallets.value = walletService.getUnlockedWallets()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load wallet data'
      console.error('Failed to load wallet data:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Load wallet data once; subsequent callers reuse the same promise.
  // Lets the router guard read accurate state even on a hard refresh.
  function ensureLoaded(): Promise<void> {
    return (loadPromise ??= loadWalletData())
  }

  // Create new wallet
  async function createWallet(password: string, name?: string): Promise<Wallet> {
    isLoading.value = true
    error.value = null

    try {
      const wallet = await walletService.createWallet(password, name)
      await loadWalletData()
      return wallet
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to create wallet'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Import wallet from mnemonic
  async function importWallet(mnemonic: string, password: string, name?: string): Promise<Wallet> {
    isLoading.value = true
    error.value = null

    try {
      const wallet = await walletService.importWallet(mnemonic, password, name)
      await loadWalletData()
      return wallet
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to import wallet'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  // Unlock wallet
  async function unlockWallet(address: string, password: string): Promise<void> {
    error.value = null

    try {
      await walletService.unlockWallet(address, password)
      await loadWalletData()
      // Notify listeners that lock state changed
      window.dispatchEvent(new CustomEvent('wallet-status-changed'))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to unlock wallet'
      throw err
    }
  }

  // Lock wallet
  function lockWallet(address: string): void {
    walletService.lockWallet(address)
    unlockedWallets.value = walletService.getUnlockedWallets()
    // Notify listeners that lock state changed
    window.dispatchEvent(new CustomEvent('wallet-status-changed'))
  }

  // Lock all wallets
  function lockAllWallets(): void {
    walletService.lockAll()
    unlockedWallets.value = []
    // Notify listeners that lock state changed
    window.dispatchEvent(new CustomEvent('wallet-status-changed'))
  }

  // Set active wallet
  async function setActiveWallet(address: string): Promise<void> {
    error.value = null

    try {
      await walletService.setActiveWallet(address)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to set active wallet'
      throw err
    }
  }

  // Set active account
  async function setActiveAccount(address: string): Promise<void> {
    error.value = null

    try {
      await walletService.setActiveAccount(address)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to set active account'
      throw err
    }
  }

  // Rename wallet
  async function renameWallet(address: string, newName: string): Promise<void> {
    error.value = null

    try {
      await walletService.renameWallet(address, newName)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to rename wallet'
      throw err
    }
  }

  // Rename account
  async function renameAccount(
    walletAddress: string,
    accountAddress: string,
    newLabel: string
  ): Promise<void> {
    error.value = null

    try {
      await walletService.renameAccount(walletAddress, accountAddress, newLabel)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to rename account'
      throw err
    }
  }

  // Hide / show account
  async function setAccountHidden(
    walletAddress: string,
    accountAddress: string,
    hidden: boolean
  ): Promise<void> {
    error.value = null

    try {
      await walletService.setAccountHidden(walletAddress, accountAddress, hidden)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to update account visibility'
      throw err
    }
  }

  // Delete wallet
  async function deleteWallet(address: string): Promise<void> {
    error.value = null

    try {
      await walletService.deleteWallet(address)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to delete wallet'
      throw err
    }
  }

  // Export mnemonic (requires unlocked wallet)
  function exportMnemonic(address: string): string {
    try {
      return walletService.exportMnemonic(address)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to export mnemonic'
      throw err
    }
  }

  // Derive new account
  async function deriveAccount(walletAddress: string, label?: string): Promise<void> {
    error.value = null

    try {
      await walletService.deriveAccount(walletAddress, label)
      await loadWalletData()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to derive account'
      throw err
    }
  }

  return {
    // State
    wallets,
    activeWallet,
    activeAccountAddress,
    unlockedWallets,
    isLoading,
    error,

    // Computed
    isActiveWalletUnlocked,
    hasWallets,

    // Methods
    loadWalletData,
    ensureLoaded,
    createWallet,
    importWallet,
    unlockWallet,
    lockWallet,
    lockAllWallets,
    setActiveWallet,
    setActiveAccount,
    renameWallet,
    renameAccount,
    setAccountHidden,
    deleteWallet,
    exportMnemonic,
    deriveAccount,
  }
}

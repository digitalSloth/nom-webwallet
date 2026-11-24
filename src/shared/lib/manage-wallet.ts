import type { useWallet } from '@/core'

export type ManageState = Pick<
  ReturnType<typeof useWallet>,
  'wallets' | 'unlockedWallets' | 'refreshLockState'
>

export const WALLET_LOCKED_MESSAGE = 'Unlock this wallet to manage it.'

export function isStored(wallet: ManageState, address: string): boolean {
  return wallet.wallets.value.some((w) => w.baseAddress === address)
}

/** Applies session expiry, then whether `address` is a stored wallet unlocked in this tab. */
export function canManage(wallet: ManageState, address: string): boolean {
  wallet.refreshLockState()
  return isStored(wallet, address) && wallet.unlockedWallets.value.includes(address)
}

/**
 * True when a manage page for `address` is open while the lock gate shows a
 * different wallet's unlock or none at all: the page must leave, because
 * another wallet's unlock cannot satisfy it.
 */
export function manageRouteMustLeave(
  wallet: ManageState,
  address: string,
  activeAddress: string | null
): boolean {
  wallet.refreshLockState()
  if (!isStored(wallet, address) || wallet.unlockedWallets.value.includes(address)) return false
  return activeAddress !== address
}

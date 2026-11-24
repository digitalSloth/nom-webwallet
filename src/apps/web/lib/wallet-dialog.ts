import { ref, readonly, watch, type Ref } from 'vue'
import { canManage, isStored, type ManageState } from '@/shared/lib/manage-wallet'

export type WalletDialogKind = 'unlock' | 'export' | 'password' | 'remove'
export interface WalletDialog {
  kind: WalletDialogKind
  address: string
}
export type { ManageState }
export { canManage }

/** At most one wallet dialog, open only while its wallet is in the state the dialog needs. */
export function useWalletDialog(wallet: ManageState): {
  dialog: Readonly<Ref<WalletDialog | null>>
  show(kind: WalletDialogKind, address: string): boolean
  close(): void
} {
  const dialog = ref<WalletDialog | null>(null)

  function show(kind: WalletDialogKind, address: string): boolean {
    if (dialog.value) return false
    wallet.refreshLockState()
    const stored = isStored(wallet, address)
    const unlocked = wallet.unlockedWallets.value.includes(address)
    if (!stored || (kind === 'unlock' ? unlocked : !unlocked)) return false
    dialog.value = { kind, address }
    return true
  }

  function close(): void {
    dialog.value = null
  }

  watch(
    () => [wallet.wallets.value, wallet.unlockedWallets.value] as const,
    () => {
      const open = dialog.value
      if (!open) return
      const stored = isStored(wallet, open.address)
      const unlocked = wallet.unlockedWallets.value.includes(open.address)
      if (!stored || (open.kind === 'unlock' ? unlocked : !unlocked)) dialog.value = null
    },
    { flush: 'sync', deep: true }
  )

  return { dialog: readonly(dialog), show, close }
}

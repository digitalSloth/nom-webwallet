import { ref, watch } from 'vue'
import { useWallet } from './useWallet'

export interface UnlockTarget {
  baseAddress: string
  name: string
}

/**
 * Pins the wallet an unlock prompt is for. The storage listener can change
 * the active wallet while the prompt is open, and a password typed for one
 * wallet must never be submitted against another. When the active wallet
 * changes under an open prompt, `onTargetChanged` runs so the host can close
 * it; the next prompt then names the new wallet.
 */
export function useUnlockTarget(onTargetChanged: () => void) {
  const wallet = useWallet()
  const unlockTarget = ref<UnlockTarget | null>(null)

  function pinActiveWallet(): void {
    const active = wallet.activeWallet.value
    unlockTarget.value = active ? { baseAddress: active.baseAddress, name: active.name } : null
  }

  watch(
    () => wallet.activeWallet.value?.baseAddress,
    (address) => {
      if (unlockTarget.value && address !== unlockTarget.value.baseAddress) {
        unlockTarget.value = null
        onTargetChanged()
      }
    }
  )

  return { unlockTarget, pinActiveWallet }
}

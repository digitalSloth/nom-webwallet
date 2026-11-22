import { computed, onScopeDispose, type ComputedRef } from 'vue'
import { useWallet } from '@/core'
import { LOCK_CHECK_MS } from '@/config'
import { noteActivity, onWebSessionChange } from '@/core/web-session'

/** The web root's session wiring. Call once, in WebApp.vue. */
export function useWebSession(): { locked: ComputedRef<boolean> } {
  const wallet = useWallet()

  function onActivity(): void {
    noteActivity()
    wallet.refreshLockState()
  }
  const options = { capture: true, passive: true } as const
  window.addEventListener('pointerdown', onActivity, options)
  window.addEventListener('keydown', onActivity, options)

  const unsubscribe = onWebSessionChange((change) => {
    if (change === 'lock') wallet.refreshLockState()
    else void wallet.loadWalletData()
  })

  const interval = setInterval(() => wallet.refreshLockState(), LOCK_CHECK_MS)

  function onVisibility(): void {
    wallet.refreshLockState()
  }
  document.addEventListener('visibilitychange', onVisibility)

  onScopeDispose(() => {
    window.removeEventListener('pointerdown', onActivity, options)
    window.removeEventListener('keydown', onActivity, options)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(interval)
    unsubscribe()
  })

  const locked = computed(() => wallet.hasWallets.value && !wallet.isActiveWalletUnlocked.value)
  return { locked }
}

import { computed, provide } from 'vue'
import type { Router } from 'vue-router'
import { SMALL_HOST_KEY, type SmallConnections } from '@/apps/small/host'
import { useWalletConnect } from '@/core'

function useWebConnections(): SmallConnections {
  const walletConnect = useWalletConnect()
  const detail = computed(() => {
    if (!walletConnect.isEnabled) return 'WalletConnect is not configured'
    const sessions = walletConnect.sessions.value.length
    return sessions === 1 ? '1 WalletConnect session' : `${sessions} WalletConnect sessions`
  })
  return { label: 'Connected apps', detail }
}

/**
 * Provides the web app's SmallHost. Call it once in the web root's setup.
 * The lock gate in WebApp.vue shows LockedOverlay whenever the active wallet
 * is locked, so an unlock request only moves to `path`, which shows once the
 * wallet unlocks.
 */
export function provideWebHost(router: Router): void {
  provide(SMALL_HOST_KEY, {
    kind: 'web',
    placeLabel: 'page',
    appVersion: __APP_VERSION__,
    useConnections: useWebConnections,
    requestUnlock: (path) => {
      if (path) void router.push(path)
    },
  })
}

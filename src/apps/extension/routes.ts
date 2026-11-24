import { createRouter, type Router, type RouterHistory } from 'vue-router'
import { useWallet } from '@/core'
import { clearSetupDraftOutside } from '@/shared/lib/create-draft'
import { lockedRouteFor, smallRoutes } from '@/apps/small/routes'

/**
 * The extension's router: the small app's routes plus the Locked screen and
 * the WalletConnect window, with the navigation guard.
 */
export function createExtensionRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      ...smallRoutes,
      {
        path: '/walletconnect',
        name: 'walletconnect',
        component: () => import('./pages/WalletConnectWindow.vue'),
        meta: { requiresWallet: true, layout: 'bare' },
      },
      {
        path: '/locked',
        name: 'locked',
        component: () => import('./pages/Locked.vue'),
        meta: { requiresWallet: true },
      },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  })

  router.beforeEach(async (to) => {
    const wallet = useWallet()

    // The guard can run before the shell mounts, so load wallet data first.
    await wallet.ensureLoaded()

    if (to.meta.requiresWallet && !wallet.hasWallets.value) {
      return { name: 'welcome' }
    }

    const locked = lockedRouteFor(to, wallet)
    if (locked) return locked

    return true
  })

  router.afterEach((to, _from, failure) => {
    if (!failure) clearSetupDraftOutside(to.name)
  })

  return router
}

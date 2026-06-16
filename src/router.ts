import {createRouter, createWebHistory} from 'vue-router'
import {useWallet} from '@/core'

declare module 'vue-router' {
  interface RouteMeta {
    // Route needs at least one wallet to exist (else → /setup)
    requiresWallet?: boolean
    // Route needs the active wallet unlocked (else → home + unlock prompt)
    requiresUnlock?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('@/pages/Home.vue'), meta: { requiresWallet: true } },
    { path: '/setup', component: () => import('@/pages/Setup.vue') },
    {
      path: '/send',
      component: () => import('@/pages/Send.vue'),
      meta: { requiresWallet: true, requiresUnlock: true },
    },
    {
      path: '/receive',
      component: () => import('@/pages/Receive.vue'),
      meta: { requiresWallet: true },
    },
    {
      path: '/token/:tokenStandard',
      component: () => import('@/pages/TokenDetails.vue'),
      meta: { requiresWallet: true },
    },
    // Catch-all: unknown paths fall back to home (which the guard re-routes to
    // /setup if no wallet exists yet).
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// Navigation guard — enforces wallet/unlock state before entering a route.
router.beforeEach(async (to) => {
  const wallet = useWallet()

  // The guard can run before App.vue's onMounted on a hard refresh, so make
  // sure wallet data is loaded before reading hasWallets / unlock state.
  await wallet.ensureLoaded()

  // First-run: no wallet yet → force the setup flow.
  if (to.meta.requiresWallet && !wallet.hasWallets.value) {
    return { path: '/setup' }
  }

  // Already set up → keep the user out of the first-run setup screen.
  if (to.path === '/setup' && wallet.hasWallets.value) {
    return { path: '/' }
  }

  // Action route reached while locked → send home and prompt an unlock.
  // App.vue consumes the `unlock` query to open the unlock dialog and, on
  // success, navigates to the original target.
  if (to.meta.requiresUnlock && !wallet.isActiveWalletUnlocked.value) {
    return { path: '/', query: { unlock: to.fullPath } }
  }

  return true
})

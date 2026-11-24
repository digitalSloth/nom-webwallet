import {
  createRouter,
  type RouteRecordRaw,
  type RouteRecordSingleView,
  type Router,
  type RouterHistory,
} from 'vue-router'
import { useToast } from 'nom-ui'
import { useWallet } from '@/core'
import { smallRoutes } from '@/apps/small/routes'
import { clearSetupDraftOutside } from '@/shared/lib/create-draft'
import { isPhoneLayout } from './breakpoint'
import { fallbackFor } from './layout-fallback'

type View = RouteRecordSingleView['component']

// The large view of each small route. A small route not listed has none.
const largeViews: Record<string, View> = {
  home: () => import('./pages/Dashboard.vue'),
  send: () => import('./pages/Send.vue'),
  receive: () => import('./pages/Receive.vue'),
  token: () => import('./pages/TokenDetails.vue'),
  tx: () => import('./pages/TxTracker.vue'),
  interrupted: () => import('./pages/Dashboard.vue'),
  plasma: () => import('./pages/Plasma.vue'),
  rewards: () => import('./pages/Rewards.vue'),
  apps: () => import('./pages/ConnectedApps.vue'),
  'settings-wallets': () => import('./pages/settings/SettingsLayout.vue'),
  'settings-security': () => import('./pages/settings/SettingsLayout.vue'),
  'settings-network': () => import('./pages/settings/SettingsLayout.vue'),
  welcome: () => import('./pages/onboarding/Welcome.vue'),
  'create-password': () => import('./pages/onboarding/CreatePassword.vue'),
  'create-phrase': () => import('./pages/onboarding/CreatePhrase.vue'),
  'create-verify': () => import('./pages/onboarding/CreateVerify.vue'),
  'import-phrase': () => import('./pages/onboarding/ImportPhrase.vue'),
  'import-password': () => import('./pages/onboarding/CreatePassword.vue'),
}

// Small views the web supplies in place of the small app's own.
const webSmallViews: Record<string, View> = {
  apps: () => import('./pages/SmallConnectedApps.vue'),
}

// First-run pages render without a layout frame and outside the lock gate.
const bareRoutes = new Set([
  'welcome',
  'create-password',
  'create-phrase',
  'create-verify',
  'import-phrase',
  'import-password',
])

function withViews(record: RouteRecordRaw): RouteRecordRaw {
  const { component, ...rest } = record as RouteRecordSingleView
  const name = String(rest.name)
  const large = largeViews[name]
  return {
    ...rest,
    meta: bareRoutes.has(name) ? { ...rest.meta, layout: 'bare' } : rest.meta,
    components: { small: webSmallViews[name] ?? component, ...(large && { large }) },
  } as RouteRecordRaw
}

/**
 * The web app's router: the small app's routes with a small and a large view
 * each, the large-only pages, and the navigation guard. The guard requires a
 * wallet to exist and moves a route with no view for the current layout
 * (`fallbackFor`). It never checks the lock: the lock gate in WebApp.vue
 * covers a locked wallet and keeps its URL, so the same page shows after an
 * unlock.
 */
export function createWebRouter(history: RouterHistory): Router {
  const router = createRouter({
    history,
    routes: [
      ...smallRoutes.map(withViews),
      {
        path: '/activity',
        name: 'activity',
        components: { large: () => import('./pages/Activity.vue') },
        meta: { requiresWallet: true },
      },
      {
        path: '/pillars',
        name: 'pillars',
        components: { large: () => import('./pages/Pillars.vue') },
        meta: { requiresWallet: true },
      },
      {
        path: '/staking',
        name: 'staking',
        components: { large: () => import('./pages/Staking.vue') },
        meta: { requiresWallet: true },
      },
      {
        path: '/tokens',
        name: 'tokens',
        components: { large: () => import('./pages/Tokens.vue') },
        meta: { requiresWallet: true },
      },
      {
        path: '/tokens/issue',
        name: 'token-issue',
        components: { large: () => import('./pages/TokenIssue.vue') },
        meta: { requiresWallet: true },
      },
      { path: '/walletconnect', redirect: { name: 'apps' } },
      { path: '/setup', redirect: { name: 'welcome' } },
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

    const fallback = fallbackFor(to, isPhoneLayout() ? 'small' : 'large')
    if (fallback) {
      if (fallback.notice) useToast().show(fallback.notice, 'info')
      return fallback.to
    }

    // A manage page of another, locked wallet makes that wallet active, so the
    // lock gate asks for its password before the page shows.
    const address = to.params.address
    if (
      typeof address === 'string' &&
      address !== wallet.activeWallet.value?.baseAddress &&
      wallet.wallets.value.some((w) => w.baseAddress === address) &&
      !wallet.unlockedWallets.value.includes(address)
    ) {
      try {
        await wallet.setActiveWallet(address)
      } catch {
        return { name: 'settings-wallets' }
      }
    }
    return true
  })

  router.afterEach((to, _from, failure) => {
    if (!failure) clearSetupDraftOutside(to.name)
  })

  return router
}

import type { RouteLocationNormalized, RouteLocationRaw, RouteRecordRaw } from 'vue-router'
import { useWallet } from '@/core'
import { getSetupDraft } from '@/shared/lib/create-draft'
import { sendDraft } from '@/shared/lib/send-draft'

// Wallet pages only open for a wallet that exists; the global guard has loaded the data.
function knownWallet(to: RouteLocationNormalized) {
  const known = useWallet().wallets.value.some((w) => w.baseAddress === to.params.address)
  return known ? true : { name: 'settings-wallets' }
}

type LockState = Pick<
  ReturnType<typeof useWallet>,
  'wallets' | 'unlockedWallets' | 'isActiveWalletUnlocked'
>

/**
 * The Locked screen location a page needs before it can open, or null when it
 * can open. A page needs the active wallet unlocked, and a manage page also
 * needs its own wallet unlocked, so a locked wallet's settings never open
 * through another, unlocked wallet.
 */
export function lockedRouteFor(
  to: Pick<RouteLocationNormalized, 'meta' | 'params' | 'fullPath'>,
  wallet: LockState
): RouteLocationRaw | null {
  if (!to.meta.requiresUnlock) return null
  const address = to.params.address
  const target =
    typeof address === 'string' && wallet.wallets.value.some((w) => w.baseAddress === address)
      ? address
      : null
  const targetLocked = target !== null && !wallet.unlockedWallets.value.includes(target)
  if (wallet.isActiveWalletUnlocked.value && !targetLocked) return null
  return { name: 'locked', query: { redirect: to.fullPath, ...(target && { wallet: target }) } }
}

/**
 * Whether a page that is mid-send may be left. A busy page stays put, except
 * for the Locked screen, so the lock watcher can still leave it.
 */
export function leaveAllowed(busy: boolean, to: Pick<RouteLocationNormalized, 'name'>): boolean {
  return !busy || to.name === 'locked'
}

/**
 * Where the Locked screen goes after an unlock. Only an in-app path is
 * accepted, and never the Locked screen itself, so a crafted query cannot loop.
 */
export function lockedRedirect(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/'
  return value.split('?')[0] === '/locked' ? '/' : value
}

/**
 * True when a Locked screen redirect points at a manage page of a wallet
 * other than `address`.
 */
export function managesOtherWallet(redirect: string, address: string): boolean {
  return (
    redirect.startsWith('/settings/wallets/') &&
    !redirect.startsWith(`/settings/wallets/${address}`)
  )
}

/**
 * The routes of the small app's pages, for a host to spread into its router.
 * The host adds its own Locked screen, catch-all and navigation guard.
 */
export const smallRoutes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/apps/small/pages/Home.vue'),
    meta: { requiresWallet: true, requiresUnlock: true, tabBar: true },
  },
  {
    path: '/send',
    name: 'send',
    component: () => import('@/apps/small/pages/Send.vue'),
    meta: { requiresWallet: true, requiresUnlock: true, tabBar: true },
  },
  {
    path: '/send/review',
    name: 'send-review',
    component: () => import('@/apps/small/pages/SendReview.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
    beforeEnter: () => (sendDraft.value ? true : { name: 'send' }),
  },
  {
    path: '/receive',
    name: 'receive',
    component: () => import('@/apps/small/pages/Receive.vue'),
    meta: { requiresWallet: true, requiresUnlock: true, tabBar: true },
  },
  {
    path: '/token/:tokenStandard',
    name: 'token',
    component: () => import('@/apps/small/pages/TokenDetails.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/tx/:hash',
    name: 'tx',
    component: () => import('@/apps/small/pages/TxTracker.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/interrupted',
    name: 'interrupted',
    component: () => import('@/apps/small/pages/TxInterrupted.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/plasma',
    name: 'plasma',
    component: () => import('@/apps/small/pages/Plasma.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/rewards',
    name: 'rewards',
    component: () => import('@/apps/small/pages/Rewards.vue'),
    meta: { requiresWallet: true, requiresUnlock: true, tabBar: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/apps/small/pages/Settings.vue'),
    meta: { requiresWallet: true, requiresUnlock: true, tabBar: true },
  },
  {
    path: '/settings/security',
    name: 'settings-security',
    component: () => import('@/apps/small/pages/Security.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/settings/network',
    name: 'settings-network',
    component: () => import('@/apps/small/pages/Network.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/apps',
    name: 'apps',
    component: () => import('@/apps/small/pages/ConnectedSites.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/settings/wallets',
    name: 'settings-wallets',
    component: () => import('@/apps/small/pages/WalletSelector.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
  },
  {
    path: '/settings/wallets/:address',
    name: 'manage-wallet',
    component: () => import('@/apps/small/pages/ManageWallet.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
    beforeEnter: knownWallet,
  },
  {
    path: '/settings/wallets/:address/export',
    name: 'export-phrase',
    component: () => import('@/apps/small/pages/ExportPhrase.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
    beforeEnter: knownWallet,
  },
  {
    path: '/settings/wallets/:address/password',
    name: 'change-password',
    component: () => import('@/apps/small/pages/ChangePassword.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
    beforeEnter: knownWallet,
  },
  {
    path: '/settings/wallets/:address/remove',
    name: 'remove-wallet',
    component: () => import('@/apps/small/pages/RemoveWallet.vue'),
    meta: { requiresWallet: true, requiresUnlock: true },
    beforeEnter: knownWallet,
  },
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/apps/small/pages/Welcome.vue'),
  },
  {
    path: '/create/password',
    name: 'create-password',
    component: () => import('@/apps/small/pages/CreatePassword.vue'),
  },
  {
    path: '/create/phrase',
    name: 'create-phrase',
    component: () => import('@/apps/small/pages/CreatePhrase.vue'),
    beforeEnter: () => (getSetupDraft()?.kind === 'create' ? true : { name: 'create-password' }),
  },
  {
    path: '/create/verify',
    name: 'create-verify',
    component: () => import('@/apps/small/pages/CreateVerify.vue'),
    beforeEnter: () => {
      const draft = getSetupDraft()
      if (draft?.kind !== 'create') return { name: 'create-password' }
      return draft.mnemonic === null ? { name: 'create-phrase' } : true
    },
  },
  {
    path: '/import',
    name: 'import-phrase',
    component: () => import('@/apps/small/pages/ImportPhrase.vue'),
  },
  {
    path: '/import/password',
    name: 'import-password',
    component: () => import('@/apps/small/pages/CreatePassword.vue'),
    beforeEnter: () => (getSetupDraft()?.kind === 'import' ? true : { name: 'import-phrase' }),
  },
]

import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme } from 'nom-ui'
import {
  onTxProgress,
  resumeTracking,
  startAutoReceive,
  startInterruptedChecks,
  useAccount,
  useNetwork,
  useWallet,
} from '@/core'
import { lockedRouteFor } from '@/apps/small/routes'
import { provideExtensionHost } from './small-host'
import { surface } from './surface'

/**
 * The extension root's behaviour: startup loading, the route to the Locked
 * screen, and the watchers that keep the open page consistent with the lock
 * state. Call it once, in ExtensionApp.vue.
 */
export function useExtensionShell(): { wallet: ReturnType<typeof useWallet> } {
  const router = useRouter()
  const route = useRoute()
  const { initTheme } = useTheme()

  const wallet = useWallet()
  const account = useAccount(() => wallet.activeAccountAddress.value)
  const network = useNetwork()

  provideExtensionHost((path) => {
    void router.push({ name: 'locked', query: { redirect: path ?? route.fullPath } })
  })

  // Every stage after publish can change balances, e.g. a reward payout once its
  // contract call executes. The root lives as long as the page, so the
  // unsubscribe function is not kept.
  onTxProgress((tx) => {
    if (tx.address === wallet.activeAccountAddress.value) void account.loadAccountData()
  })

  // The popup never loads the WalletConnect stack. The WalletConnect window
  // starts it itself.
  let stopChecks: (() => void) | null = null

  // Only a wallet window receives. The approval and WalletConnect windows never sign here.
  const stopAutoReceive =
    surface === 'popup' || surface === 'tab' || surface === 'sidepanel'
      ? startAutoReceive({ wallet, account, network })
      : null

  onMounted(async () => {
    await initTheme()
    await wallet.ensureLoaded()

    if (wallet.hasWallets.value) {
      await network.initialize()
      void resumeTracking()

      if (wallet.activeAccountAddress.value) {
        await account.loadAccountData()
      }
    }

    if (surface === 'popup' || surface === 'tab' || surface === 'sidepanel') {
      stopChecks = startInterruptedChecks(router, { popupStart: surface === 'popup' })
    }
  })
  onBeforeUnmount(() => {
    stopChecks?.()
    stopAutoReceive?.()
  })

  // Reload wallet data on navigation, e.g. after a wallet was just created.
  watch(
    () => route.path,
    async () => {
      await wallet.loadWalletData()

      if (wallet.hasWallets.value) {
        await network.initialize()
      }

      if (wallet.activeAccountAddress.value) {
        await account.loadAccountData()
      }
    }
  )

  watch(
    () => wallet.activeAccountAddress.value,
    async (address) => {
      if (address) await account.loadAccountData()
    }
  )

  // Auto-lock, lock all, a lock from another document and the header lock
  // button all end here.
  watch(
    [
      () => wallet.isActiveWalletUnlocked.value,
      () => wallet.unlockedWallets.value,
      () => route.fullPath,
    ],
    () => {
      const locked = lockedRouteFor(route, wallet)
      if (locked) void router.replace(locked)
    }
  )

  watch(
    () => wallet.hasWallets.value,
    (hasWallets) => {
      if (!hasWallets && route.meta.requiresWallet) void router.replace({ name: 'welcome' })
    }
  )

  return { wallet }
}

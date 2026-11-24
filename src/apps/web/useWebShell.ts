import { inject, onBeforeUnmount, onMounted, provide, watch, type InjectionKey } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTheme, useToast } from 'nom-ui'
import {
  onTxProgress,
  resumeTracking,
  startAutoReceive,
  startInterruptedChecks,
  useAccount,
  useNetwork,
  useWallet,
  useWalletConnect,
} from '@/core'
import { WALLETCONNECT_ENABLED } from '@/config'
import { usePhoneLayout } from './breakpoint'
import { fallbackFor } from './layout-fallback'
import { layoutHeld } from './layout-hold'
import { manageRouteMustLeave } from '@/shared/lib/manage-wallet'
import { provideWebHost } from './small-host'

export interface WebShell {
  wallet: ReturnType<typeof useWallet>
  account: ReturnType<typeof useAccount>
  network: ReturnType<typeof useNetwork>
}

const WEB_SHELL_KEY: InjectionKey<WebShell> = Symbol('web-shell')

/**
 * The web root's startup and watchers. Call it once, in WebApp.vue. The
 * layout components read it back with injectWebShell().
 */
export function useWebShell(): WebShell {
  const router = useRouter()
  const route = useRoute()
  const { initTheme } = useTheme()
  const walletConnect = useWalletConnect()

  const wallet = useWallet()
  const account = useAccount(() => wallet.activeAccountAddress.value)
  const network = useNetwork()
  const toast = useToast()

  provideWebHost(router)

  // Crossing 900 px keeps the user on a page the new layout has. While a send
  // holds the layout, the move waits until it is released.
  const phone = usePhoneLayout()
  function applyFallback(): void {
    const fallback = fallbackFor(route, phone.value ? 'small' : 'large')
    if (!fallback) return
    if (fallback.notice) toast.show(fallback.notice, 'info')
    void router.replace(fallback.to)
  }
  watch(phone, () => {
    if (!layoutHeld.value) applyFallback()
  })
  watch(layoutHeld, (held) => {
    if (!held) applyFallback()
  })

  // A manage page needs its own wallet unlocked. Locking it, or choosing
  // another wallet in the unlock overlay, sends the user back to the wallets list.
  watch(
    () =>
      [
        route.params.address,
        wallet.activeWallet.value?.baseAddress,
        wallet.unlockedWallets.value,
        wallet.wallets.value,
      ] as const,
    ([address, active]) => {
      if (typeof address !== 'string') return
      if (manageRouteMustLeave(wallet, address, active ?? null)) {
        void router.replace({ name: 'settings-wallets' })
      }
    },
    { deep: true }
  )

  const stopAutoReceive = startAutoReceive({ wallet, account, network })
  onBeforeUnmount(stopAutoReceive)

  // Every stage after publish can change balances, e.g. a reward payout once its
  // contract call executes. The root lives as long as the page, so the
  // unsubscribe function is not kept.
  onTxProgress((tx) => {
    if (tx.address === wallet.activeAccountAddress.value) void account.loadAccountData()
  })

  onMounted(async () => {
    await initTheme()

    // Shared one-time load; the router guard may have already triggered it.
    // Wallet-state redirects (no wallet → /welcome) are owned by the router guard.
    await wallet.ensureLoaded()

    if (wallet.hasWallets.value) {
      await network.initialize()
      void resumeTracking()

      if (wallet.activeAccountAddress.value) {
        await account.loadAccountData()
      }
    }

    startInterruptedChecks(router, { popupStart: false })

    // Starting WalletConnect on load lets a request arrive without the
    // Connected apps page being open.
    if (!WALLETCONNECT_ENABLED) return
    try {
      await walletConnect.initialize()
    } catch (error) {
      console.error('Failed to initialize WalletConnect:', error)
    }
  })

  // Reload wallet data on route changes (a wallet may have just been created).
  watch(
    () => route.path,
    async () => {
      if (route.meta.layout !== 'bare') {
        await wallet.loadWalletData()

        if (wallet.hasWallets.value) {
          await network.initialize()
        }

        if (wallet.activeAccountAddress.value) {
          await account.loadAccountData()
        }
      }
    }
  )

  watch(
    () => wallet.activeAccountAddress.value,
    async (newAddress) => {
      if (newAddress) {
        await account.loadAccountData()
      }
    }
  )

  // Redirect to welcome once no wallets remain.
  watch(
    () => wallet.hasWallets.value,
    (hasWallets) => {
      if (!hasWallets && route.meta.layout !== 'bare') {
        router.push({ name: 'welcome' })
      }
    }
  )

  const shell: WebShell = { wallet, account, network }
  provide(WEB_SHELL_KEY, shell)
  return shell
}

export function injectWebShell(): WebShell {
  const shell = inject(WEB_SHELL_KEY)
  if (!shell) throw new Error('injectWebShell() needs useWebShell() in WebApp.vue.')
  return shell
}

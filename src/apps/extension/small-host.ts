import { computed, onMounted, provide } from 'vue'
import { SMALL_HOST_KEY, type SmallConnections, type SmallHost } from '@/apps/small/host'
import { WALLETCONNECT_ENABLED } from '@/config'
import { useConnectedSites } from '@/core/composables/useConnectedSites'
import { useWalletConnectSessions } from '@/core/composables/useWalletConnectSessions'
import SidePanelSettingRow from './components/SidePanelSettingRow.vue'
import { placeLabelFor, surface } from './surface'

function useExtensionConnections(): SmallConnections {
  const connectedSites = useConnectedSites()
  const walletConnect = useWalletConnectSessions()

  const detail = computed(() => {
    const sites = connectedSites.sites.value.length
    const sitesText = sites === 1 ? '1 site' : `${sites} sites`
    if (!WALLETCONNECT_ENABLED) return sitesText
    const sessions = walletConnect.sessions.value.length
    const sessionsText =
      sessions === 1 ? '1 WalletConnect session' : `${sessions} WalletConnect sessions`
    return `${sitesText} · ${sessionsText}`
  })

  onMounted(() => {
    void connectedSites.refresh()
    void walletConnect.refresh()
  })

  return { label: 'Connected sites', detail }
}

/** Provides the extension's SmallHost. Call it once in a root component's setup. */
export function provideExtensionHost(requestUnlock: SmallHost['requestUnlock']): void {
  provide(SMALL_HOST_KEY, {
    kind: 'extension',
    placeLabel: placeLabelFor(surface),
    appVersion: chrome.runtime.getManifest().version,
    settingsExtras: SidePanelSettingRow,
    useConnections: useExtensionConnections,
    requestUnlock,
  })
}

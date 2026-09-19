import { ref } from 'vue'
import type { Ref } from 'vue'
import { INTERNAL_MESSAGE_CHANNEL, type PortsDisconnectMessage } from '../inpage-protocol'
import { list, revoke, revokeAll, type SitePermission } from '../site-permissions'

/**
 * Reactive wrapper around site-permissions.ts for the settings dialog's
 * connected-sites section (§6.7). Deliberately not exported from
 * composables/index.ts or the @/core barrel — importing this by path keeps
 * a chrome.storage-calling module out of the web bundle.
 */

const sites = ref<SitePermission[]>([])
const isLoading = ref(false)

function requestPortsDisconnect(origin?: string): void {
  if (!__IS_EXTENSION__) return
  const message: PortsDisconnectMessage = { channel: INTERNAL_MESSAGE_CHANNEL, kind: 'ports.disconnect', origin }
  void chrome.runtime.sendMessage(message)
}

export function useConnectedSites(): {
  sites: Ref<SitePermission[]>
  isLoading: Ref<boolean>
  refresh(): Promise<void>
  revokeOrigin(origin: string): Promise<void>
  revokeAllSites(): Promise<void>
} {
  async function refresh(): Promise<void> {
    isLoading.value = true
    try {
      sites.value = await list()
    } finally {
      isLoading.value = false
    }
  }

  async function revokeOrigin(origin: string): Promise<void> {
    await revoke(origin)
    // Storage is already updated above (any extension context can write
    // chrome.storage.local); this additionally asks the worker to drop the
    // live port, which only it can see (§6.4, §6.7).
    requestPortsDisconnect(origin)
    await refresh()
  }

  async function revokeAllSites(): Promise<void> {
    await revokeAll()
    requestPortsDisconnect()
    await refresh()
  }

  return { sites, isLoading, refresh, revokeOrigin, revokeAllSites }
}

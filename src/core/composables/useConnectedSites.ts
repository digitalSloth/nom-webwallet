import { ref } from 'vue'
import type { Ref } from 'vue'
import { INTERNAL_MESSAGE_CHANNEL, type SitesRevokeMessage } from '../inpage-protocol'
import { list, type SitePermission } from '../site-permissions'

/**
 * Reactive wrapper around site-permissions.ts for the settings dialog's
 * connected-sites section (§6.7). Deliberately not exported from
 * composables/index.ts or the @/core barrel — importing this by path keeps
 * a chrome.storage-calling module out of the web bundle.
 */

const sites = ref<SitePermission[]>([])
const isLoading = ref(false)

/**
 * The worker performs the revoke, not this page: a write from here could
 * interleave with the worker's own read-modify-writes of the same map and
 * be overwritten by a stale copy (§6.7).
 */
async function requestRevoke(origin?: string): Promise<void> {
  if (!__IS_EXTENSION__) return
  const message: SitesRevokeMessage = { channel: INTERNAL_MESSAGE_CHANNEL, kind: 'sites.revoke', origin }
  await chrome.runtime.sendMessage(message)
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
    await requestRevoke(origin)
    await refresh()
  }

  async function revokeAllSites(): Promise<void> {
    await requestRevoke()
    await refresh()
  }

  return { sites, isLoading, refresh, revokeOrigin, revokeAllSites }
}

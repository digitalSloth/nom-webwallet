import { DEFAULT_NODE_URL, STORAGE_KEY_CHAIN_ID, STORAGE_KEY_SELECTED_NODE, STORAGE_KEY_WALLETS } from '@/config'
import type { WalletStorage } from '@/types'
import type { PortEventMessage, ProviderEventName } from '@/core/inpage-protocol'
import { list as listGrantedOrigins } from '@/core/site-permissions'
import { broadcastEvent } from './ports'

/**
 * Reads address/chainId/nodeUrl straight from chrome.storage.local — never
 * via wallet-service.ts or zenon-service.ts, which pull in the SDK. Falls
 * back to DEFAULT_NODE_URL and chain 1 on a fresh install with no persisted
 * config, matching ZenonService's own constructor defaults (§6.8) so the
 * worker and the page never disagree.
 */

export async function getActiveAccountAddress(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_WALLETS)
  const data = stored[STORAGE_KEY_WALLETS] as WalletStorage | undefined
  return data?.activeAccountAddress ?? null
}

/** No wallet in storage at all — there is nothing to unlock into (§6.2). */
export async function hasAnyWallet(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_WALLETS)
  const data = stored[STORAGE_KEY_WALLETS] as WalletStorage | undefined
  return (data?.wallets.length ?? 0) > 0
}

export async function getChainId(): Promise<number> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_CHAIN_ID)
  const value = stored[STORAGE_KEY_CHAIN_ID]
  return typeof value === 'number' ? value : 1
}

export async function getNodeUrl(): Promise<string> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_SELECTED_NODE)
  const value = stored[STORAGE_KEY_SELECTED_NODE]
  return typeof value === 'string' ? value : DEFAULT_NODE_URL
}

function eventMessage(name: ProviderEventName, data: unknown): PortEventMessage {
  return { kind: 'event', name, data }
}

async function broadcastToGrantedOrigins(message: PortEventMessage): Promise<void> {
  const origins = await listGrantedOrigins()
  for (const { origin } of origins) {
    broadcastEvent(origin, message)
  }
}

// Registered synchronously at module top level (background.ts imports this
// module for its side effect), so any storage write wakes a terminated
// worker and is never missed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return

  if (STORAGE_KEY_WALLETS in changes) {
    // The wallets blob changes for many reasons (rename, derive, hide) that
    // are not an active-account switch — only broadcast when the active
    // address itself actually changed.
    const before = changes[STORAGE_KEY_WALLETS].oldValue as WalletStorage | undefined
    const after = changes[STORAGE_KEY_WALLETS].newValue as WalletStorage | undefined
    const oldAddress = before?.activeAccountAddress ?? null
    const newAddress = after?.activeAccountAddress ?? null
    if (oldAddress !== newAddress) {
      void broadcastToGrantedOrigins(eventMessage('accountsChanged', newAddress ? [newAddress] : []))
    }
  }

  if (STORAGE_KEY_CHAIN_ID in changes) {
    const value = changes[STORAGE_KEY_CHAIN_ID].newValue
    void broadcastToGrantedOrigins(eventMessage('chainChanged', typeof value === 'number' ? value : 1))
  }

  if (STORAGE_KEY_SELECTED_NODE in changes) {
    const value = changes[STORAGE_KEY_SELECTED_NODE].newValue
    void broadcastToGrantedOrigins(
      eventMessage('nodeChanged', typeof value === 'string' ? value : DEFAULT_NODE_URL)
    )
  }
})

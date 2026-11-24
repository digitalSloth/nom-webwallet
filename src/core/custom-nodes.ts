import { DEFAULT_NODES, STORAGE_KEY_CUSTOM_NODES, STORAGE_KEY_SELECTED_NODE } from '@/config'
import type { NodeEntry } from '@/types'
import { storageService } from './storage/storage-service'
import { readPersistedChainId, readPersistedNetworkId } from './zenon-service'

export function isBuiltInNode(url: string): boolean {
  return DEFAULT_NODES.some((node) => node.url === url)
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/**
 * Reads the custom node list. chrome.storage keeps a Vue reactive array as
 * an object keyed by index, so both shapes come back as a list. A list of
 * bare URLs (the earlier format) takes the chain and network ID the wallet
 * is running on, and is written back once in the entry format.
 */
export async function readCustomNodes(): Promise<NodeEntry[]> {
  const stored = await storageService.get<unknown>(STORAGE_KEY_CUSTOM_NODES)
  const values: unknown[] = Array.isArray(stored)
    ? stored
    : stored !== null && typeof stored === 'object'
      ? Object.values(stored)
      : []
  const [chainId, networkId] = await Promise.all([readPersistedChainId(), readPersistedNetworkId()])

  const result: NodeEntry[] = []
  let hadString = false
  for (const value of values) {
    if (typeof value === 'string') {
      hadString = true
      result.push({ url: value, chainId, networkId })
    } else if (value !== null && typeof value === 'object') {
      const entry = value as Record<string, unknown>
      if (typeof entry.url === 'string' && isId(entry.chainId) && isId(entry.networkId)) {
        result.push({ url: entry.url, chainId: entry.chainId, networkId: entry.networkId })
      }
    }
  }

  let appended = false
  if (hadString || stored === null || stored === undefined) {
    const selected = await storageService.get<unknown>(STORAGE_KEY_SELECTED_NODE)
    if (
      typeof selected === 'string' &&
      !isBuiltInNode(selected) &&
      !result.some((entry) => entry.url === selected)
    ) {
      result.push({ url: selected, chainId, networkId })
      appended = true
    }
  }

  if (hadString || appended) await writeCustomNodes(result)
  return result
}

export async function writeCustomNodes(list: readonly NodeEntry[]): Promise<void> {
  await storageService.set(
    STORAGE_KEY_CUSTOM_NODES,
    list.map(({ url, chainId, networkId }) => ({ url, chainId, networkId }))
  )
}

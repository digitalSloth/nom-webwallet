import { CONNECT_TIMEOUT_MS, DEFAULT_NODES } from '@/config'
import { NodeChainMismatchError } from '@/core/composables/useNetwork'
import type { NodeEntry } from '@/types'
import { urlHost } from '@/shared/lib/format'

export interface NodeOption extends NodeEntry {
  kind: 'Mainnet' | 'Custom'
  custom: boolean
  /** The chain and network ID as shown in a row. */
  ids: string
}

function option(entry: NodeEntry, kind: NodeOption['kind']): NodeOption {
  return {
    url: entry.url,
    chainId: entry.chainId,
    networkId: entry.networkId,
    kind,
    custom: kind === 'Custom',
    ids: `chain ${entry.chainId} · net ${entry.networkId}`,
  }
}

/** DEFAULT_NODES as Mainnet, then each custom entry whose URL is not already listed, in order. */
export function nodeOptions(customNodes: readonly NodeEntry[]): NodeOption[] {
  const options = DEFAULT_NODES.map((node) => option(node, 'Mainnet'))
  const seen = new Set<string>(DEFAULT_NODES.map((node) => node.url))
  for (const node of customNodes) {
    if (seen.has(node.url)) continue
    seen.add(node.url)
    options.push(option(node, 'Custom'))
  }
  return options
}

/** The trimmed text when it starts with `ws://` or `wss://` and parses as a URL with a non-empty host, else null. */
export function parseNodeUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('wss://') && !trimmed.startsWith('ws://')) return null
  try {
    return new URL(trimmed).hostname !== '' ? trimmed : null
  } catch {
    return null
  }
}

/** The sentence shown when a node switch fails. */
export function nodeFailureText(url: string, err: unknown, currentNode: string): string {
  if (err instanceof NodeChainMismatchError) {
    return `That node is on chain ID ${err.nodeChainId}, not chain ID ${err.expectedChainId}. Still using ${urlHost(currentNode)}.`
  }
  return `Couldn't reach ${url} within ${CONNECT_TIMEOUT_MS / 1000} seconds. Still using ${urlHost(currentNode)}.`
}

/** A positive safe integer from `^[1-9][0-9]*$` text, else null. */
export function parseId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}

import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { CONNECT_TIMEOUT_MS, DEFAULT_NODES } from '@/config'
import { isBuiltInNode, readCustomNodes, writeCustomNodes } from '../custom-nodes'
import { probeChainId } from '../node-probe'
import { urlHost } from '@/shared/lib/format'
import {
  nodeFailureText,
  nodeOptions,
  parseId,
  parseNodeUrl,
  type NodeOption,
} from '@/shared/lib/node-options'
import type { NodeEntry } from '@/types'
import { useNetwork } from './useNetwork'

export type NodeCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'failed'; message: string }
  | {
      status: 'reachable'
      url: string
      chainInput: string
      networkInput: string
      error: string | null
    }

export interface NodeEdit {
  url: string
  chainInput: string
  networkInput: string
  error: string | null
}

const IDS_INVALID = 'Chain ID and Network ID must be positive whole numbers.'
const NOT_SAVED = 'Connected, but the node could not be saved to your list.'

// Module-level so a node saved by a deep link shows in an open Network page.
const customNodes = ref<NodeEntry[]>([])

export function useNodes(): {
  rows: ComputedRef<NodeOption[]>
  pending: Readonly<Ref<string | null>>
  busy: ComputedRef<boolean>
  listError: Ref<string | null>
  addUrl: Ref<string>
  check: Ref<NodeCheck>
  edit: Ref<NodeEdit | null>
  load(): Promise<void>
  select(entry: NodeEntry): Promise<void>
  remove(url: string): Promise<void>
  checkNode(): Promise<void>
  addAndConnect(): Promise<void>
  startEdit(entry: NodeEntry): void
  cancelEdit(): void
  saveEdit(): Promise<void>
  saveEntry(entry: NodeEntry): Promise<void>
} {
  const network = useNetwork()

  const pending = ref<string | null>(null)
  const listError = ref<string | null>(null)
  const addUrl = ref('')
  const check = ref<NodeCheck>({ status: 'idle' })
  const edit = ref<NodeEdit | null>(null)

  const rows = computed(() => nodeOptions(customNodes.value))
  const busy = computed(() => pending.value !== null || check.value.status === 'checking')

  watch(
    addUrl,
    () => {
      if (check.value.status === 'reachable' || check.value.status === 'failed') {
        check.value = { status: 'idle' }
      }
    },
    { flush: 'sync' }
  )

  async function load(): Promise<void> {
    try {
      customNodes.value = await readCustomNodes()
    } catch (err) {
      console.error('Failed to read the custom node list:', err)
    }
  }

  // Resolves null when the node is connected, else the error that stopped the switch.
  async function connect(entry: NodeEntry): Promise<unknown> {
    pending.value = entry.url
    try {
      await network.selectNode({
        url: entry.url,
        chainId: entry.chainId,
        networkId: entry.networkId,
      })
      return null
    } catch (err) {
      return err ?? new Error('Failed to connect')
    } finally {
      pending.value = null
    }
  }

  async function select(entry: NodeEntry): Promise<void> {
    if (busy.value || entry.url === network.currentNode.value) return
    listError.value = null
    const failure = await connect(entry)
    if (failure !== null) {
      listError.value = nodeFailureText(entry.url, failure, network.currentNode.value)
    }
  }

  async function saveEntry(entry: NodeEntry): Promise<void> {
    if (isBuiltInNode(entry.url)) return
    const saved = { url: entry.url, chainId: entry.chainId, networkId: entry.networkId }
    const exists = customNodes.value.some((node) => node.url === entry.url)
    const next = exists
      ? customNodes.value.map((node) => (node.url === entry.url ? saved : node))
      : [...customNodes.value, saved]
    await writeCustomNodes(next)
    customNodes.value = next
  }

  async function remove(url: string): Promise<void> {
    if (busy.value) return
    listError.value = null
    if (url === network.currentNode.value) {
      const fallback = DEFAULT_NODES[0]
      if ((await connect(fallback)) !== null) {
        listError.value = `Could not switch to ${urlHost(fallback.url)}, so ${urlHost(url)} was not removed.`
        return
      }
    }
    if (edit.value?.url === url) edit.value = null
    const next = customNodes.value.filter((node) => node.url !== url)
    try {
      await writeCustomNodes(next)
      customNodes.value = next
    } catch {
      listError.value = 'Could not save your node list.'
      await load()
    }
  }

  async function checkNode(): Promise<void> {
    if (busy.value || addUrl.value.trim() === '') return
    listError.value = null
    const url = parseNodeUrl(addUrl.value)
    if (url === null) {
      check.value = {
        status: 'failed',
        message:
          'Enter a node URL starting with wss:// or ws://, such as wss://node.example.com:35998.',
      }
      return
    }
    const listed = rows.value.find((row) => row.url === url)
    if (listed) {
      await select(listed)
      addUrl.value = ''
      return
    }
    check.value = { status: 'checking' }
    try {
      const chainId = await probeChainId(url)
      check.value = {
        status: 'reachable',
        url,
        chainInput: String(chainId),
        networkInput: String(chainId),
        error: null,
      }
    } catch {
      check.value = {
        status: 'failed',
        message: `Couldn't reach ${url} within ${CONNECT_TIMEOUT_MS / 1000} seconds. Check the URL and port.`,
      }
    }
  }

  // Connects to the node with the typed IDs, then saves it. Resolves the
  // error sentence, or null when both steps worked.
  async function connectAndSave(
    url: string,
    chainInput: string,
    networkInput: string
  ): Promise<string | null> {
    const chainId = parseId(chainInput.trim())
    const networkId = parseId(networkInput.trim())
    if (chainId === null || networkId === null) return IDS_INVALID
    const entry = { url, chainId, networkId }
    const failure = await connect(entry)
    if (failure !== null) return nodeFailureText(url, failure, network.currentNode.value)
    try {
      await saveEntry(entry)
    } catch {
      return NOT_SAVED
    }
    return null
  }

  async function addAndConnect(): Promise<void> {
    const current = check.value
    if (current.status !== 'reachable' || busy.value) return
    const error = await connectAndSave(current.url, current.chainInput, current.networkInput)
    if (error === null) {
      check.value = { status: 'idle' }
      addUrl.value = ''
    } else if (check.value.status === 'reachable') {
      check.value = { ...check.value, error }
    }
  }

  function startEdit(entry: NodeEntry): void {
    edit.value = {
      url: entry.url,
      chainInput: String(entry.chainId),
      networkInput: String(entry.networkId),
      error: null,
    }
  }

  function cancelEdit(): void {
    edit.value = null
  }

  async function saveEdit(): Promise<void> {
    const current = edit.value
    if (!current || busy.value) return
    const error = await connectAndSave(current.url, current.chainInput, current.networkInput)
    if (error === null) edit.value = null
    else if (edit.value) edit.value = { ...edit.value, error }
  }

  return {
    rows,
    pending,
    busy,
    listError,
    addUrl,
    check,
    edit,
    load,
    select,
    remove,
    checkNode,
    addAndConnect,
    startEdit,
    cancelEdit,
    saveEdit,
    saveEntry,
  }
}

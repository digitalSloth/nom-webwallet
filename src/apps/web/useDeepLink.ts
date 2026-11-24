import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { useToast } from 'nom-ui'
import { CONNECT_TIMEOUT_MS } from '@/config'
import { NodeChainMismatchError, useNetwork, useNodes } from '@/core'
import { isBuiltInNode } from '@/core/custom-nodes'
import { urlHost } from '@/shared/lib/format'
import { parseId, parseNodeUrl } from '@/shared/lib/node-options'
import type { NodeEntry } from '@/types'

// A link's node, chainId and networkId come from an untrusted source: they
// apply only after the user confirms, and any invalid value voids the link.
export interface DeepLinkRequest {
  node: string | null
  chainId: number | null
  networkId: number | null
}

// Connect stays disabled this long after a request appears, so a click
// aimed at something else cannot land on it.
const ARM_DELAY_MS = 750

const LINK_KEYS = ['node', 'chainId', 'networkId'] as const

// The dialog shows the node text as given, so it must read the way it
// parses: no credentials (`host@evil`), and printable ASCII only, which
// rules out lookalike hosts and bidi control characters.
function safeNode(text: string): string | null {
  const node = parseNodeUrl(text)
  if (node === null || /[^\x21-\x7e]/.test(node)) return null
  const url = new URL(node)
  return url.username === '' && url.password === '' ? node : null
}

/** null when the query has none of node, chainId, networkId; 'invalid' when any present one fails. */
export function parseDeepLink(query: LocationQuery): DeepLinkRequest | 'invalid' | null {
  if (LINK_KEYS.every((key) => query[key] === undefined)) return null

  let node: string | null = null
  if (query.node !== undefined) {
    node = typeof query.node === 'string' ? safeNode(query.node) : null
    if (node === null) return 'invalid'
  }
  let chainId: number | null = null
  if (query.chainId !== undefined) {
    chainId = parseId(query.chainId)
    if (chainId === null) return 'invalid'
  }
  let networkId: number | null = null
  if (query.networkId !== undefined) {
    networkId = parseId(query.networkId)
    if (networkId === null) return 'invalid'
  }
  return { node, chainId, networkId }
}

/** The entry a link selects. `known` is every listed node; `current` is the wallet's node and IDs now. */
export function linkEntry(
  link: DeepLinkRequest,
  known: readonly NodeEntry[],
  current: NodeEntry
): NodeEntry {
  const url = link.node ?? current.url
  const base = known.find((entry) => entry.url === url) ?? current
  const chainId = link.chainId ?? base.chainId
  const networkId = link.networkId ?? (chainId === base.chainId ? base.networkId : chainId)
  return { url, chainId, networkId }
}

export interface LinkPreview {
  entry: NodeEntry
  /** true when the link names a chain ID or applying it changes the chain ID. */
  showChainId: boolean
  /** true when the link names a network ID or applying it changes the network ID. */
  showNetworkId: boolean
}

/** What the dialog shows: the resolved entry, with the IDs that are named or would change. */
export function linkPreview(
  link: DeepLinkRequest,
  known: readonly NodeEntry[],
  current: NodeEntry
): LinkPreview {
  const entry = linkEntry(link, known, current)
  return {
    entry,
    showChainId: link.chainId !== null || entry.chainId !== current.chainId,
    showNetworkId: link.networkId !== null || entry.networkId !== current.networkId,
  }
}

/** The sentence shown when applying a link fails. */
export function deepLinkFailureText(
  err: unknown,
  stage: 'config' | 'node' | 'built-in',
  now: { node: string; chainId: number }
): string {
  const still = `You're still on ${urlHost(now.node)}, chain ID ${now.chainId}.`
  if (stage === 'built-in') {
    return `Built-in nodes use chain ID 1 and network ID 1, so this link needs a node of its own. ${still}`
  }
  if (err instanceof NodeChainMismatchError) {
    return `That node is on chain ID ${err.nodeChainId}, not chain ID ${err.expectedChainId}. ${still}`
  }
  if (stage === 'node') {
    return `Couldn't reach that node within ${CONNECT_TIMEOUT_MS / 1000} seconds. ${still}`
  }
  return `Couldn't save the network settings. ${still}`
}

/**
 * `options.paused` tells the composable the dialog cannot be on screen
 * (another modal is showing). The arm delay runs only while a request is
 * visible, and restarts each time it becomes visible.
 */
export function useDeepLink(options: { paused?: () => boolean } = {}): {
  request: Readonly<Ref<DeepLinkRequest | null>>
  /** The resolved node and IDs the request applies, null without a request. */
  preview: ComputedRef<LinkPreview | null>
  isConnecting: Readonly<Ref<boolean>>
  /** false for a short delay after the request becomes visible; confirm does nothing until then. */
  armed: Readonly<Ref<boolean>>
  failure: Readonly<Ref<string | null>>
  confirm(): Promise<void>
  cancel(): void
} {
  const route = useRoute()
  const router = useRouter()
  const network = useNetwork()
  const nodes = useNodes()
  const toast = useToast()

  const request = ref<DeepLinkRequest | null>(null)
  const isConnecting = ref(false)
  const failure = ref<string | null>(null)
  const armed = ref(false)
  // true once the saved network settings and the node list have loaded for the current request
  const ready = ref(false)
  let loadToken = 0
  const currentEntry = (): NodeEntry => ({
    url: network.currentNode.value,
    chainId: network.chainId.value,
    networkId: network.networkId.value,
  })
  const preview = computed(() =>
    request.value ? linkPreview(request.value, nodes.rows.value, currentEntry()) : null
  )

  let armTimer: ReturnType<typeof setTimeout> | undefined
  const visibleRequest = () => (options.paused?.() || !ready.value ? null : request.value)
  function arm(): void {
    clearTimeout(armTimer)
    armed.value = false
    if (visibleRequest()) armTimer = setTimeout(() => (armed.value = true), ARM_DELAY_MS)
  }
  watch(visibleRequest, arm, { flush: 'sync' })
  // A changed preview needs a fresh look before Connect works again.
  watch(() => (ready.value && preview.value ? JSON.stringify(preview.value) : null), arm, {
    flush: 'sync',
  })

  // A click queued before a tab switch must not land on Connect afterwards.
  function onReturn(): void {
    if (document.visibilityState === 'hidden') return
    arm()
  }
  window.addEventListener('focus', onReturn)
  document.addEventListener('visibilitychange', onReturn)
  onScopeDispose(() => {
    window.removeEventListener('focus', onReturn)
    document.removeEventListener('visibilitychange', onReturn)
  })
  onScopeDispose(() => clearTimeout(armTimer))

  watch(
    () => route.query,
    (query) => {
      const parsed = parseDeepLink(query)
      if (parsed === null) return

      const rest = { ...query }
      for (const key of LINK_KEYS) delete rest[key]
      void router.replace({ path: route.path, query: rest, hash: route.hash })

      if (parsed === 'invalid' || isConnecting.value) return
      request.value = parsed
      failure.value = null
      // The preview resolves against the saved network settings and the node list.
      ready.value = false
      const token = ++loadToken
      Promise.all([network.loadConfig(), nodes.load()]).then(
        () => {
          if (token === loadToken) ready.value = true
        },
        () => {
          if (token === loadToken) failure.value = "Couldn't load your network settings."
        }
      )
    },
    { immediate: true }
  )

  async function confirm(): Promise<void> {
    const pending = request.value
    if (!pending || isConnecting.value || !armed.value) return

    const shown = preview.value?.entry
    const shownNow = currentEntry()
    isConnecting.value = true
    failure.value = null
    let stage: 'config' | 'node' = 'config'
    const now = () => ({ node: network.currentNode.value, chainId: network.chainId.value })
    try {
      await network.loadConfig()
      await nodes.load()
      const entry = linkEntry(pending, nodes.rows.value, currentEntry())
      if (
        !shown ||
        entry.url !== shown.url ||
        entry.chainId !== shown.chainId ||
        entry.networkId !== shown.networkId ||
        network.currentNode.value !== shownNow.url ||
        network.chainId.value !== shownNow.chainId ||
        network.networkId.value !== shownNow.networkId
      ) {
        failure.value = `The network settings changed while this was open. Check them and try again. You're still on ${urlHost(network.currentNode.value)}, chain ID ${network.chainId.value}.`
        return
      }
      if (isBuiltInNode(entry.url) && (entry.chainId !== 1 || entry.networkId !== 1)) {
        failure.value = deepLinkFailureText(null, 'built-in', now())
        return
      }
      stage = 'node'
      await network.selectNode(entry)
      try {
        await nodes.saveEntry(entry)
      } catch {
        request.value = null
        toast.show('Connected, but the node could not be saved to your list.', 'error')
        return
      }
      request.value = null
      toast.show('Network updated.', 'success')
    } catch (err) {
      failure.value = deepLinkFailureText(err, stage, now())
    } finally {
      isConnecting.value = false
    }
  }

  function cancel(): void {
    if (isConnecting.value) return
    loadToken++
    request.value = null
    failure.value = null
  }

  return { request, preview, isConnecting, armed, failure, confirm, cancel }
}

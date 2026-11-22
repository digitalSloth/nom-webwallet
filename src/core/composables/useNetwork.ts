import { ref } from 'vue'
import { readPersistedChainId, readPersistedNetworkId, ZenonService } from '../zenon-service'
import { TransactionService } from '../transaction-service'
import {
  DEFAULT_NODE_URL,
  STORAGE_KEY_CHAIN_ID,
  STORAGE_KEY_NETWORK_ID,
  STORAGE_KEY_SELECTED_NODE,
} from '@/config'
import { storageService } from '../storage/storage-service'
import type { NodeEntry } from '@/types'
import { nodeDown, reportNodeFailure, reportNodeSuccess, startNodeRetry } from '../node-health'

// Module-level reactive state — shared across every useNetwork() caller
const isConnected = ref(false)
const currentNode = ref(DEFAULT_NODE_URL)
const isChecking = ref(false)
const error = ref<string | null>(null)
const currentMomentum = ref<number>(0)
const chainId = ref<number>(1)
const networkId = ref<number>(1)

/** Opt-in behaviour. Defaults to false; each app turns it on in its init. */
let networkOptions = { nodeRetry: false }

export function configureNetwork(options: { nodeRetry: boolean }): void {
  networkOptions = { ...options }
}

export class NodeChainMismatchError extends Error {
  constructor(
    readonly nodeChainId: number,
    readonly expectedChainId: number
  ) {
    super(`Node is on chain ID ${nodeChainId}, expected chain ID ${expectedChainId}`)
    this.name = 'NodeChainMismatchError'
  }
}

export function useNetwork() {
  const zenonService = ZenonService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Verify connection by making a real API call
  // Returns the node's chain id, or null when the node did not answer.
  async function checkConnection(): Promise<number | null> {
    isChecking.value = true
    error.value = null

    try {
      await transactionService.ensureInitialized()
      const momentum = await zenonService.getZenon().ledger.getFrontierMomentum()
      currentMomentum.value = momentum.height
      isConnected.value = true
      reportNodeSuccess()
      return momentum.chainIdentifier
    } catch (err) {
      isConnected.value = false
      reportNodeFailure()
      error.value = err instanceof Error ? err.message : 'Connection failed'
      console.error('Failed to check connection:', err)
      return null
    } finally {
      isChecking.value = false
    }
  }

  // Connect to a node, check it serves the entry's chain, then persist the
  // node with its chain and network ID and apply them. A failure at any step
  // restores the previous node and IDs.
  async function selectNode(entry: NodeEntry) {
    isChecking.value = true
    error.value = null

    const previous = {
      url: currentNode.value,
      chainId: chainId.value,
      networkId: networkId.value,
    }
    let persistStarted = false
    let reachedNode = false
    try {
      currentNode.value = entry.url
      await zenonService.changeNode(entry.url)
      const nodeChainId = await checkConnection()
      if (nodeChainId === null) {
        // checkConnection() swallows its error but records the reason in
        // error.value — surface it so the caller can report the failure.
        throw new Error(error.value ?? 'Failed to connect to node')
      }
      reachedNode = true
      if (nodeChainId !== entry.chainId) {
        throw new NodeChainMismatchError(nodeChainId, entry.chainId)
      }
      // Persist only after the node is proven reachable, so a node that can't
      // connect is never stored and reapplied on next boot. The IDs apply to
      // the live session only once they are stored.
      persistStarted = true
      await Promise.all([
        storageService.set(STORAGE_KEY_SELECTED_NODE, entry.url),
        storageService.set(STORAGE_KEY_CHAIN_ID, entry.chainId),
        storageService.set(STORAGE_KEY_NETWORK_ID, entry.networkId),
      ])
      ZenonService.updateNetworkConfig(entry.chainId, entry.networkId)
      chainId.value = entry.chainId
      networkId.value = entry.networkId
    } catch (err) {
      currentNode.value = previous.url
      isConnected.value = false
      const failure = err instanceof Error ? err.message : 'Failed to change node'
      error.value = failure
      if (persistStarted) {
        try {
          await Promise.all([
            storageService.set(STORAGE_KEY_SELECTED_NODE, previous.url),
            storageService.set(STORAGE_KEY_CHAIN_ID, previous.chainId),
            storageService.set(STORAGE_KEY_NETWORK_ID, previous.networkId),
          ])
        } catch {
          // ignore — surfacing the original error is what matters
        }
      }
      // The service may have connected to the new (unverified) node before the
      // verification call failed. Restore the previous node so the service and UI
      // don't disagree, and so the next operation doesn't silently reuse the bad
      // node. Best-effort — never mask the original failure.
      if (zenonService.getNodeUrl() !== previous.url) {
        try {
          await zenonService.changeNode(previous.url)
          await checkConnection()
        } catch {
          // ignore — surfacing the original error is what matters
        }
      } else if (reachedNode) {
        isConnected.value = true
      }
      // checkConnection() clears error.value; keep the original failure.
      error.value = failure
      throw err
    } finally {
      isChecking.value = false
    }
  }

  // Load frontier momentum
  async function loadFrontierMomentum() {
    try {
      await transactionService.ensureInitialized()
      const zenon = zenonService.getZenon()
      const momentum = await zenon.ledger.getFrontierMomentum()
      currentMomentum.value = momentum.height
    } catch (err) {
      console.error('Failed to load frontier momentum:', err)
    }
  }

  // Initialize network (call on app mount).
  //
  // ZenonService resolves the persisted node + network config from storage
  // before opening its first connection (see applyPersistedConfig), so any data
  // load that races us still connects straight to the saved node — no
  // default-node round-trip. Here we just trigger the connection and mirror the
  // resolved values into reactive state for the UI.
  async function initialize() {
    await checkConnection()
    currentNode.value = zenonService.getNodeUrl()
    chainId.value = zenonService.getChainId()
    networkId.value = zenonService.getNetworkId()
    if (networkOptions.nodeRetry) startNodeRetry(checkConnection)
  }

  // Mirror the persisted node + network config into reactive state without
  // connecting, for pages that only display it and must not wait on a node.
  async function loadConfig() {
    await zenonService.ensureConfigLoaded()
    currentNode.value = zenonService.getNodeUrl()
    chainId.value = zenonService.getChainId()
    networkId.value = zenonService.getNetworkId()
  }

  // Adopt the chain/network IDs another extension window persisted, without
  // writing them back. Applies them to the SDK and reactive state, as
  // selectNode() does after its own write.
  async function syncNetworkConfig() {
    const [storedChainId, storedNetworkId] = await Promise.all([
      readPersistedChainId(),
      readPersistedNetworkId(),
    ])
    ZenonService.updateNetworkConfig(storedChainId, storedNetworkId)
    chainId.value = storedChainId
    networkId.value = storedNetworkId
  }

  return {
    // State
    isConnected,
    currentNode,
    isChecking,
    nodeDown,
    error,
    currentMomentum,
    chainId,
    networkId,

    // Methods
    checkConnection,
    selectNode,
    initialize,
    loadConfig,
    syncNetworkConfig,
    loadFrontierMomentum,
  }
}

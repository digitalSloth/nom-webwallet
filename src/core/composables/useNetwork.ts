import {ref} from 'vue'
import {ZenonService} from '../zenon-service'
import {TransactionService} from '../transaction-service'
import {DEFAULT_NODE_URL, STORAGE_KEY_CHAIN_ID, STORAGE_KEY_NETWORK_ID, STORAGE_KEY_SELECTED_NODE,} from '@/config'
import {storageService} from '../storage/storage-service'

// Module-level reactive state — shared across every useNetwork() caller
const isConnected = ref(false)
const currentNode = ref(DEFAULT_NODE_URL)
const isChecking = ref(false)
const error = ref<string | null>(null)
const currentMomentum = ref<number>(0)
const chainId = ref<number>(1)
const networkId = ref<number>(1)

export function useNetwork() {
  const zenonService = ZenonService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Verify connection by making a real API call
  async function checkConnection() {
    isChecking.value = true
    error.value = null

    try {
      await transactionService.ensureInitialized()
      const momentum = await zenonService.getZenon().ledger.getFrontierMomentum()
      currentMomentum.value = momentum.height
      isConnected.value = true
    } catch (err) {
      isConnected.value = false
      error.value = err instanceof Error ? err.message : 'Connection failed'
      console.error('Failed to check connection:', err)
    } finally {
      isChecking.value = false
    }
  }

  // Change node and persist
  async function changeNode(nodeUrl: string) {
    isChecking.value = true
    error.value = null

    try {
      currentNode.value = nodeUrl
      await storageService.set(STORAGE_KEY_SELECTED_NODE, nodeUrl)
      await zenonService.changeNode(nodeUrl)
      await checkConnection()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to change node'
      isConnected.value = false
      throw err
    } finally {
      isChecking.value = false
    }
  }

  // Update chain/network IDs, apply to SDK, and persist.
  // Awaits the writes and surfaces failures to the caller so the UI can report
  // an accurate success/failure result.
  async function updateNetworkConfig(newChainId: number, newNetworkId: number) {
    chainId.value = newChainId
    networkId.value = newNetworkId
    ZenonService.updateNetworkConfig(newChainId, newNetworkId)
    await Promise.all([
      storageService.set(STORAGE_KEY_CHAIN_ID, newChainId),
      storageService.set(STORAGE_KEY_NETWORK_ID, newNetworkId),
    ])
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
  }

  return {
    // State
    isConnected,
    currentNode,
    isChecking,
    error,
    currentMomentum,
    chainId,
    networkId,

    // Methods
    checkConnection,
    changeNode,
    updateNetworkConfig,
    initialize,
    loadFrontierMomentum,
  }
}

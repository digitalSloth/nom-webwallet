import {ref} from 'vue'
import {ZenonService} from '../zenon-service'
import {TransactionService} from '../transaction-service'
import {DEFAULT_NODE_URL} from '@/config'

// Module-level reactive state — shared across every useNetwork() caller
const isConnected = ref(false)
const currentNode = ref(DEFAULT_NODE_URL)
const isChecking = ref(false)
const error = ref<string | null>(null)
const currentMomentum = ref<number>(0)

export function useNetwork() {
  const zenonService = ZenonService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Check connection status
  async function checkConnection() {
    isChecking.value = true
    error.value = null

    try {
      await transactionService.ensureInitialized()
      isConnected.value = true
    } catch (err) {
      isConnected.value = false
      error.value = err instanceof Error ? err.message : 'Connection failed'
      console.error('Failed to check connection:', err)
    } finally {
      isChecking.value = false
    }
  }

  // Change node
  async function changeNode(nodeUrl: string) {
    isChecking.value = true
    error.value = null

    try {
      currentNode.value = nodeUrl
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

  // Initialize network (call on app mount)
  async function initialize() {
    await checkConnection()
  }

  return {
    // State
    isConnected,
    currentNode,
    isChecking,
    error,
    currentMomentum,

    // Methods
    checkConnection,
    changeNode,
    initialize,
    loadFrontierMomentum,
  }
}

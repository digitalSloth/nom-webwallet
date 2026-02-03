import {ref} from 'vue'
import {PlasmaService} from '../plasma-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import type {FusionEntry} from 'znn-typescript-sdk'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every usePlasma() caller
const fusionEntries = ref<FusionEntry[]>([])
const isLoading = ref(false)
const isFusing = ref(false)
const isCanceling = ref(false)
const cancelingFusionId = ref<string | null>(null)
const error = ref<string | null>(null)

export function usePlasma() {
  const plasmaService = PlasmaService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load fusion entries for an address
  async function loadFusionEntries(address: string, pageIndex: number = 0, pageSize: number = 25) {
    if (!address) {
      fusionEntries.value = []
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await plasmaService.getFusionEntries(address, pageIndex, pageSize)
      fusionEntries.value = result.list || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load fusion entries'
      console.error('Failed to load fusion entries:', err)
      fusionEntries.value = []
    } finally {
      isLoading.value = false
    }
  }

  // Fuse QSR to generate plasma
  async function fuseQsr(
    wallet: Wallet,
    accountAddress: string,
    beneficiaryAddress: string,
    amount: bigint
  ): Promise<void> {
    isFusing.value = true
    error.value = null

    try {
      // Get keyStore
      const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
      if (!keyStore) {
        throw new Error('Wallet is locked. Please unlock it first.')
      }

      // Find account
      const account = wallet.accounts.find((acc) => acc.address === accountAddress)
      if (!account) {
        throw new Error('Account not found')
      }

      // Get keypair
      const keyPair = keyStore.getKeyPair(account.index)

      await runActivity('Fusing QSR for plasma', async () => {
        // Create fuse block
        const block = plasmaService.createFuseBlock(beneficiaryAddress, amount)

        // Send transaction
        await transactionService.sendEmbeddedContractBlock(block, keyPair)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fuse QSR'
      throw err
    } finally {
      isFusing.value = false
    }
  }

  // Cancel a fusion
  async function cancelFusion(
    wallet: Wallet,
    accountAddress: string,
    fusionId: string
  ): Promise<void> {
    isCanceling.value = true
    cancelingFusionId.value = fusionId
    error.value = null

    try {
      // Get keyStore
      const keyStore = sessionManager.getKeyStore(wallet.baseAddress)
      if (!keyStore) {
        throw new Error('Wallet is locked. Please unlock it first.')
      }

      // Find account
      const account = wallet.accounts.find((acc) => acc.address === accountAddress)
      if (!account) {
        throw new Error('Account not found')
      }

      // Get keypair
      const keyPair = keyStore.getKeyPair(account.index)

      await runActivity('Cancelling fusion', async () => {
        // Create cancel block
        const block = plasmaService.createCancelBlock(fusionId)

        // Send transaction
        await transactionService.sendEmbeddedContractBlock(block, keyPair)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to cancel fusion'
      throw err
    } finally {
      isCanceling.value = false
      cancelingFusionId.value = null
    }
  }

  return {
    // State
    fusionEntries,
    isLoading,
    isFusing,
    isCanceling,
    cancelingFusionId,
    error,

    // Methods
    loadFusionEntries,
    fuseQsr,
    cancelFusion,
  }
}

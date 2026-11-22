import {ref} from 'vue'
import {PlasmaService} from '../plasma-service'
import {TransactionService} from '../transaction-service'
import {sessionManager} from '../session-manager'
import {runActivity} from './useActivity'
import {trackTransaction} from './useTxTracker'
import type {AccountBlockTemplate, FusionEntry} from 'znn-typescript-sdk'
import type {TxMeta} from '../send-recorder'
import type {Wallet} from '@/types'

// Module-level reactive state — shared across every usePlasma() caller
const fusionEntries = ref<FusionEntry[]>([])
const isLoading = ref(false)
const isFusing = ref(false)
const isCanceling = ref(false)
const cancelingFusionId = ref<string | null>(null)
const error = ref<string | null>(null)
let latestLoad = 0

export function usePlasma() {
  const plasmaService = PlasmaService.getInstance()
  const transactionService = TransactionService.getInstance()

  // Load fusion entries for an address
  async function loadFusionEntries(address: string, pageIndex: number = 0, pageSize: number = 25) {
    const load = ++latestLoad
    if (!address) {
      fusionEntries.value = []
      isLoading.value = false
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const result = await plasmaService.getFusionEntries(address, pageIndex, pageSize)
      // A newer load owns the list; an older response must not overwrite it.
      if (load === latestLoad) fusionEntries.value = result.list || []
    } catch (err) {
      if (load !== latestLoad) return
      error.value = err instanceof Error ? err.message : 'Failed to load fusion entries'
      console.error('Failed to load fusion entries:', err)
      fusionEntries.value = []
    } finally {
      if (load === latestLoad) isLoading.value = false
    }
  }

  // Fuse QSR to generate plasma
  async function fuseQsr(
    wallet: Wallet,
    accountAddress: string,
    beneficiaryAddress: string,
    amount: bigint,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
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

      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Fusing QSR for plasma', async () => {
        // Create fuse block
        const block = plasmaService.createFuseBlock(beneficiaryAddress, amount)

        // Send transaction
        const sent = await transactionService.sendEmbeddedContractBlock(
          block,
          keyPair,
          undefined,
          context
        )
        void trackTransaction(meta?.title ?? 'Fuse QSR', sent, meta)
        return sent
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
    fusionId: string,
    meta?: TxMeta
  ): Promise<AccountBlockTemplate> {
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

      const context = meta ? { ...meta, from: accountAddress } : undefined
      return await runActivity('Cancelling fusion', async () => {
        // Create cancel block
        const block = plasmaService.createCancelBlock(fusionId)

        // Send transaction
        const sent = await transactionService.sendEmbeddedContractBlock(
          block,
          keyPair,
          undefined,
          context
        )
        void trackTransaction(meta?.title ?? 'Cancel fusion', sent, meta)
        return sent
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

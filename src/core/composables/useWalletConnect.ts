import { ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { SessionTypes } from '@walletconnect/types'
import { WALLETCONNECT_ENABLED } from '@/config'
import { WalletConnectService, walletConnectSessions } from '../walletconnect-service'
import { useWallet } from './useWallet'
import { useNetwork } from './useNetwork'

/**
 * Module-level singleton state for pairing and sessions only — approvals
 * belong to useDappApprovals. `sessions` itself lives in
 * walletconnect-service.ts (the module that receives the client's events);
 * this composable only adds the operation-status state around calling it,
 * matching useNetwork.ts's isChecking/error pattern.
 */
const isInitialized = ref(false)
const isPairing = ref(false)
const error = ref<string | null>(null)
let watchersStarted = false

export function useWalletConnect(): {
  isEnabled: boolean
  isInitialized: Ref<boolean>
  isPairing: Ref<boolean>
  sessions: ComputedRef<SessionTypes.Struct[]>
  error: Ref<string | null>
  initialize(): Promise<void>
  pair(uri: string): Promise<void>
  disconnect(topic: string): Promise<void>
} {
  const service = WalletConnectService.getInstance()

  function startWatchers(): void {
    if (watchersStarted) return
    watchersStarted = true

    const wallet = useWallet()
    const network = useNetwork()

    watch(wallet.activeAccountAddress, (address) => {
      if (address) void service.setActiveAccount(address)
    })
    watch(network.chainId, (chainId) => void service.emitChainIdChange(chainId))
  }

  async function initialize(): Promise<void> {
    if (!WALLETCONNECT_ENABLED || isInitialized.value) return

    error.value = null
    try {
      await service.initialize()
      isInitialized.value = true
      startWatchers()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to initialize WalletConnect'
      throw err
    }
  }

  async function pair(uri: string): Promise<void> {
    isPairing.value = true
    error.value = null
    try {
      await service.pair(uri)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to pair'
      throw err
    } finally {
      isPairing.value = false
    }
  }

  async function disconnect(topic: string): Promise<void> {
    await service.disconnect(topic)
  }

  return {
    isEnabled: WALLETCONNECT_ENABLED,
    isInitialized,
    isPairing,
    sessions: walletConnectSessions,
    error,
    initialize,
    pair,
    disconnect,
  }
}

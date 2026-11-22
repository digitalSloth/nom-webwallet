import { useWallet } from '@/core'
import { configureAccountData } from '@/core/composables/useAccount'
import { configureNetwork } from '@/core/composables/useNetwork'
import { configureInterruptedSends } from '@/core/composables/useInterruptedSends'
import { configureTxTracker } from '@/core/composables/useTxTracker'
import { onKeyCacheChange, startKeyCache } from '@/core/key-cache'
import { setSendRecorder } from '@/core/send-recorder'
import { createSessionSendRecorder, sessionInterruptedSource } from '@/core/session-send-recorder'
import { surface } from './surface'

/**
 * Prepares an extension document before its app mounts: joins the shared key
 * cache and refreshes the wallet list when another document unlocks or locks.
 * It also records sends for interrupted-send detection and configures
 * tracking. Never rejects, so the app mounts even when the key cache cannot start.
 */
export async function initExtensionDocument(): Promise<void> {
  setSendRecorder(createSessionSendRecorder(surface))
  configureInterruptedSends(sessionInterruptedSource)
  configureTxTracker({
    toasts: false,
    followRecipient: true,
  })
  configureAccountData({ staking: false })
  configureNetwork({ nodeRetry: true })
  await startKeyCache()
  onKeyCacheChange(() => void useWallet().loadWalletData())
}

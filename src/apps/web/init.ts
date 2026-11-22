import { configureNetwork } from '@/core/composables/useNetwork'
import { configureTxTracker } from '@/core/composables/useTxTracker'
import { configureInterruptedSends } from '@/core/composables/useInterruptedSends'
import {
  createLocalSendRecorder,
  localInterruptedSource,
  resumeTabLock,
  startTabLock,
  suspendTabLock,
} from '@/core/local-send-recorder'
import { setSendRecorder } from '@/core/send-recorder'
import { suspendPendingPublishes } from '@/core/transaction-service'
import { startWebSession } from '@/core/web-session'

/**
 * Prepares the web document before the app mounts: turns on the node
 * retry loop and the node chain check, sends tracker progress to the
 * sidebar toast, takes this tab's lock, installs the IndexedDB send
 * recorder and its interrupted-send source, stops unpublished sends when
 * the page enters the back/forward cache, and starts the web session
 * (activity auto-lock, cross-tab lock, storage sync). Never rejects.
 */
export async function initWebDocument(): Promise<void> {
  configureNetwork({ nodeRetry: true })
  configureTxTracker({ toasts: false, followRecipient: true })
  await startTabLock()
  setSendRecorder(createLocalSendRecorder())
  configureInterruptedSends(localInterruptedSource)
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) return
    suspendPendingPublishes()
    suspendTabLock()
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void resumeTabLock()
  })
  await startWebSession()
}

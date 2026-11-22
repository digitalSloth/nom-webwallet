import { ref, type Ref } from 'vue'
import { SESSION_KEY_WALLETCONNECT_PAIR_RESULT, STORAGE_KEY_WC_SESSION_SUMMARY } from '@/config'
import {
  activeSessions,
  clearPairResult,
  openWalletConnectWindow,
  readPairResult,
  readSessionSummary,
  sendWalletConnectCommand,
  type WalletConnectSessionSummary,
} from '../walletconnect-bridge'

// Module-level reactive state, shared across every caller
const sessions = ref<WalletConnectSessionSummary[]>([])
const pairFailed = ref(false)
let started = false
let changeCount = 0

async function checkPairResult(): Promise<void> {
  const result = await readPairResult()
  if (!result) return
  await clearPairResult()
  pairFailed.value = !result.ok
}

function start(): void {
  started = true
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session') {
      if (changes[SESSION_KEY_WALLETCONNECT_PAIR_RESULT]?.newValue !== undefined) {
        void checkPairResult()
      }
      return
    }
    if (areaName !== 'local' || !(STORAGE_KEY_WC_SESSION_SUMMARY in changes)) return
    changeCount++
    sessions.value = activeSessions(changes[STORAGE_KEY_WC_SESSION_SUMMARY].newValue, Date.now())
  })
}

/**
 * The popup's view of the WalletConnect sessions held by the WalletConnect
 * window, plus the pair and end actions. Extension only: import it by path,
 * not through the barrels, so the web bundle never loads it.
 */
export function useWalletConnectSessions(): {
  sessions: Readonly<Ref<WalletConnectSessionSummary[]>>
  pairFailed: Readonly<Ref<boolean>>
  /** Reads the stored pair result once: clears the key and sets pairFailed from it. */
  checkPairResult(): Promise<void>
  clearPairError(): void
  refresh(): Promise<void>
  open(): Promise<void>
  pair(uri: string): Promise<void>
  end(topic: string): Promise<void>
  endAll(): Promise<void>
} {
  if (!started) start()

  async function refresh(): Promise<void> {
    const before = changeCount
    const stored = await readSessionSummary()
    if (changeCount === before) sessions.value = stored
  }

  return {
    sessions,
    pairFailed,
    checkPairResult,
    clearPairError: () => {
      pairFailed.value = false
    },
    refresh,
    open: openWalletConnectWindow,
    pair: async (uri) => {
      pairFailed.value = false
      await clearPairResult()
      await sendWalletConnectCommand({ kind: 'pair', uri: uri.trim() })
    },
    end: (topic) => sendWalletConnectCommand({ kind: 'disconnect', topic }),
    endAll: () => sendWalletConnectCommand({ kind: 'disconnectAll' }),
  }
}

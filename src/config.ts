/**
 * Centralized application configuration: network parameters, on-chain
 * constants, defaults, and feature flags. Prefer importing from here over
 * hardcoding magic numbers/URLs in components.
 */

import type { NodeEntry } from '@/types'

// --- Node / network defaults ---
export const DEFAULT_NODE_URL = 'wss://node.zenonhub.io:35998'

// --- Network storage keys ---
export const STORAGE_KEY_SELECTED_NODE = 'nom-wallet-selected-node'
export const STORAGE_KEY_CHAIN_ID = 'nom-wallet-chain-id'
export const STORAGE_KEY_NETWORK_ID = 'nom-wallet-network-id'

/** Built-in node URLs offered in the network selector. */
export const DEFAULT_NODES: NodeEntry[] = [
  { url: DEFAULT_NODE_URL, chainId: 1, networkId: 1 },
  { url: 'wss://my.hc1node.com:35998', chainId: 1, networkId: 1 },
]

/**
 * Websocket connect timeout (ms) for node switches. The SDK defaults to 30s,
 * which leaves the UI hanging that long on an unreachable node before reporting
 * failure — 8s fails fast while still tolerating a slower-but-healthy node.
 */
export const CONNECT_TIMEOUT_MS = 8000
/** node-health.ts. Gap between two connection checks while the node is unreachable. */
export const NODE_RETRY_MS = 10_000
/** format.ts. Base URL of the block explorer; pages append /block/, /account/ or /momentum/. */
export const EXPLORER_URL = 'https://zenonhub.io/explorer'

// --- Momentum / block timing ---
/** Target time between momentums (blocks), in seconds. */
export const BLOCK_TIME_SECONDS = 10
/** Momentums produced per hour (one every BLOCK_TIME_SECONDS). */
export const BLOCKS_PER_HOUR = (60 * 60) / BLOCK_TIME_SECONDS // 360

// --- Plasma (QSR fusion) ---
/** Minimum QSR that can be fused for plasma. */
export const MIN_FUSE_AMOUNT_QSR = 10
/** Hours a fusion is locked before it can be revoked/cancelled. */
export const PLASMA_REVOKE_HOURS = 10
/** Revoke lock expressed in momentums. */
export const PLASMA_REVOKE_BLOCKS = BLOCKS_PER_HOUR * PLASMA_REVOKE_HOURS // 3600

// --- Staking ---
/** Minimum ZNN that can be staked. */
export const MIN_STAKE_AMOUNT_ZNN = 1
/**
 * The Zenon stake contract measures duration in 30-day "months" (not calendar
 * months/years); allowed durations are 1–12 of these units.
 */
export const STAKE_MONTH_SECONDS = 30 * 24 * 60 * 60 // 2_592_000

export interface StakeDurationOption {
  label: string
  /** Duration in seconds (a multiple of STAKE_MONTH_SECONDS). */
  value: number
}

export const STAKE_DURATION_OPTIONS: StakeDurationOption[] = [
  { label: '1 Month', value: 1 * STAKE_MONTH_SECONDS },
  { label: '3 Months', value: 3 * STAKE_MONTH_SECONDS },
  { label: '6 Months', value: 6 * STAKE_MONTH_SECONDS },
  { label: '9 Months', value: 9 * STAKE_MONTH_SECONDS },
  { label: '12 Months', value: 12 * STAKE_MONTH_SECONDS },
]

// SDK RPC_MAX_PAGE_SIZE; one read, no pager
export const TOKEN_OWNED_PAGE_SIZE = 1024

// go-zenon TokenIssueAmount: 1 ZNN in base units
export const TOKEN_ISSUE_FEE = 100_000_000n

// --- Wallet / security ---
/** Minimum password length for wallet encryption. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Minimum acceptable password-strength score (0–4) to create/import a wallet.
 * 2 = "Fair". See estimatePasswordStrength in core/password-strength.ts.
 */
export const MIN_PASSWORD_SCORE = 2

/** Human labels for the 0–4 password-strength score. */
export const PASSWORD_STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const

/**
 * Strong Argon2id KDF params for new and upgraded wallets. Passed to the SDK's
 * `KeyFile.encrypt()`, which persists them in the keyfile (self-describing) and
 * falls back to its weaker DEFAULT_CONFIG when decrypting legacy keyfiles. Also
 * the target for `KeyFile.needsUpgrade()` on unlock. timeCost is tuned to keep
 * unlock under ~1.5s in the browser (argon2-browser/WASM); shape matches the
 * SDK's `KdfConfig` (memory cost in KiB).
 */
export const KDF_CONFIG = {
  timeCost: 3,
  memoryCost: 64 * 1024,
  hashLength: 32,
  parallelism: 4,
} as const

// --- dApp surfaces ---

/** phase 1 — wallet-service.ts. Moved here so the service worker (phase 3a/3b)
 *  can read `activeAccountAddress` without importing wallet-service.ts and its
 *  SDK dependency. */
export const STORAGE_KEY_WALLETS = 'nom-wallet-storage'

/** phase 1 — dapp-approvals.ts. Cap on a single document's pending-approval
 *  queue; enforced per document, not shared across surfaces. */
export const MAX_PENDING_DAPP_REQUESTS = 5
/** Pending requests one origin may hold, so one site cannot fill the shared queue. */
export const MAX_PENDING_PER_ORIGIN = 3
/** Pending requests one browser tab may hold, across the page and its iframes. */
export const MAX_PENDING_PER_TAB = 3

/** phase 2 — WalletConnect surface. */
export const WALLETCONNECT_PROJECT_ID: string = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''
/** phase 2 — WalletConnect surface. */
export const WALLETCONNECT_ENABLED = WALLETCONNECT_PROJECT_ID.length >= 32
/** phase 2 — WalletConnect surface. The wallet's own peer identity, rendered
 *  as text and an image inside every dApp that pairs with it. */
export const WALLETCONNECT_METADATA = {
  name: 'NoM Wallet',
  description: 'A secure cryptocurrency wallet for the Zenon Network of Momentum.',
  url: 'https://github.com/digitalSloth/nom-webwallet',
  icons: ['https://raw.githubusercontent.com/digitalSloth/nom-webwallet/main/icons/icon-128.png'],
}
/** phase 2 — WalletConnect surface. */
export const WC_STORAGE_PREFIX = 'nom-wallet-wc:'

/** phase 3a — site-permissions.ts. */
export const STORAGE_KEY_SITE_PERMISSIONS = 'nom-wallet-site-permissions'
/** site-permissions.ts. Minimum gap between two lastUsedAt writes for one origin. */
export const SITE_PERMISSION_TOUCH_INTERVAL_MS = 60 * 1000

/** phase 3b — approval-inbox.ts. */
export const SESSION_KEY_PENDING_REQUESTS = 'nom-wallet.pendingRequests'
/** phase 3b — approval-inbox.ts. */
export const SESSION_KEY_APPROVAL_WINDOW_ID = 'nom-wallet.approvalWindowId'
/** phase 3b — approval-inbox.ts. */
export const SESSION_KEY_OUTCOMES = 'nom-wallet.outcomes'
/** phase 3b — approval-inbox.ts. */
export const APPROVAL_WINDOW_IDLE_MS = 5 * 60 * 1000
/**
 * phase 3b — approval-inbox.ts. Retention for outcomes that have already been
 * delivered, for duplicate suppression only. Undelivered outcomes are never
 * expired.
 */
export const DELIVERED_OUTCOME_TTL_MS = 60 * 1000

/** ExtensionApp.vue — the extension's WalletConnect popup window, reused across opens. */
export const SESSION_KEY_WALLETCONNECT_WINDOW_ID = 'nom-wallet.walletConnectWindowId'

/** tx-tracker.ts. Storage key for the transactions still being tracked. */
export const STORAGE_KEY_TRACKED_TRANSACTIONS = 'nom-wallet-tracked-transactions'
/** tx-tracker.ts. Gap between two reads of a tracked transaction. */
export const TX_TRACK_POLL_MS = 5000
/**
 * tx-tracker.ts. Cap on one read of a tracked transaction. A read that
 * outlasts it is dropped, and the next poll reads again.
 */
export const TX_TRACK_READ_TIMEOUT_MS = 5000
/** tx-tracker.ts. How long a transaction is tracked after publish before the wallet gives up. */
export const TX_TRACK_TIMEOUT_MS = 5 * 60 * 1000
/**
 * transaction-service.ts. Ceiling on one send once it leaves the queue. It
 * covers the node connect (CONNECT_TIMEOUT_MS), PoW and the send's RPC
 * calls, with margin.
 */
export const SEND_TIMEOUT_MS = 3 * 60 * 1000
/**
 * transaction-service.ts. How long after the timeout an abandoned send may
 * stay unsettled (a hung RPC call) before its record stops its heartbeat
 * and is listed as an interrupted record that may have been sent, even while its tab is open.
 */
export const SEND_ABANDONED_DEADLINE_MS = 2 * SEND_TIMEOUT_MS
/** key-cache.ts. Prefix of the session-storage key that holds one unlocked wallet's entropy. */
export const SESSION_KEY_PREFIX_UNLOCKED = 'nom-wallet.key:'
/** key-cache.ts, sw/auto-lock.ts: session-storage key; web-session.ts: localStorage key. The last user activity time (ms). */
export const SESSION_KEY_LAST_ACTIVITY = 'nom-wallet.lastActivityAt'
/** key-cache.ts, sw/auto-lock.ts. Name of the chrome.alarms alarm that wipes the key cache. */
export const AUTO_LOCK_ALARM = 'nom-wallet.autoLock'
/** auto-lock-policy.ts. Minutes of inactivity before an unlocked wallet locks. */
export const DEFAULT_AUTO_LOCK_MINUTES = 30
/** auto-lock-policy.ts. chrome.storage.local key that holds the chosen auto-lock minutes. */
export const STORAGE_KEY_AUTO_LOCK_MINUTES = 'nom-wallet-auto-lock-minutes'
/** auto-lock-policy.ts. The auto-lock times (minutes) the user can pick in Security. */
export const AUTO_LOCK_CHOICES = [5, 15, 30, 60] as const
/** sw/side-panel-approvals.ts. chrome.storage.session key of the registry that maps a browser window id to the document id of its open side panel. */
export const SESSION_KEY_SIDE_PANELS = 'nom-wallet.sidePanels'
/** sw/side-panel.ts, useSidePanelSetting.ts. chrome.storage.local key that holds whether the toolbar icon opens the side panel (boolean). */
export const STORAGE_KEY_SIDE_PANEL = 'nom-wallet-side-panel'
/** useAutoReceiveSetting.ts. Storage key that holds whether auto-receive is on (boolean). */
export const STORAGE_KEY_AUTO_RECEIVE = 'nom-wallet-auto-receive'
/** useAutoReceive.ts. Storage key that holds the start times (ms) of recent auto-receives that needed Proof-of-Work (number[]). */
export const STORAGE_KEY_AUTO_RECEIVE_POW = 'nom-wallet-auto-receive-pow'
/** useAutoReceive.ts. Web Lock name that lets one document at a time auto-receive. */
export const AUTO_RECEIVE_LOCK = 'nom-wallet.auto-receive'
/** useAutoReceive.ts. Wait before a pass retries after a busy send queue or a held lock, and the first backoff after a failure. */
export const AUTO_RECEIVE_RETRY_MS = 30_000
/** useAutoReceive.ts. Longest wait between two passes after repeated failures. */
export const AUTO_RECEIVE_MAX_BACKOFF_MS = 10 * 60_000
/** useAutoReceive.ts. Unreceived blocks read per page. */
export const AUTO_RECEIVE_PAGE_SIZE = 50
/** useAutoReceive.ts. Pages of unreceived blocks one pass reads. */
export const AUTO_RECEIVE_MAX_PAGES = 4
/** useAutoReceive.ts. Most receives that need Proof-of-Work one device makes per window. */
export const AUTO_RECEIVE_POW_LIMIT = 20
/** useAutoReceive.ts. Length of the window that AUTO_RECEIVE_POW_LIMIT counts in. */
export const AUTO_RECEIVE_POW_WINDOW_MS = 10 * 60_000
/** key-cache.ts. Minimum gap between two activity writes to session storage. */
export const KEY_CACHE_TOUCH_INTERVAL_MS = 15_000
/** web-session.ts. localStorage key. When a web tab last locked every wallet (ms). */
export const SESSION_KEY_LOCKED_AT = 'nom-wallet.lockedAt'
/** useWebSession.ts. Gap between two lock-state checks in a web tab. */
export const LOCK_CHECK_MS = 5_000
/** web-session.ts. BroadcastChannel that carries lock messages between web tabs. */
export const WEB_SESSION_CHANNEL = 'nom-wallet.session'
/** session-send-recorder.ts. Prefix of the session-storage key that holds one in-flight send record. */
export const SESSION_KEY_PREFIX_SEND = 'nom-wallet.send:'
/** session-send-recorder.ts, local-send-recorder.ts. Gap between two heartbeat writes of an in-flight send record. */
export const SEND_HEARTBEAT_MS = 5_000
/** send-record.ts. Heartbeat age after which a send record counts as interrupted. */
export const SEND_STALE_MS = 15_000
/** send-record-store.ts. IndexedDB database that holds the web send records. */
export const WEB_SEND_DB_NAME = 'nom-wallet'
/** send-record-store.ts. Object store of the web send records. */
export const WEB_SEND_STORE = 'sends'
/** local-send-recorder.ts. Prefix of the Web Lock name each web tab holds while it is open. */
export const WEB_TAB_LOCK_PREFIX = 'nom-wallet.tab:'
/** custom-nodes.ts. Storage key of the user's custom node list. */
export const STORAGE_KEY_CUSTOM_NODES = 'nom-wallet-custom-nodes'
/** walletconnect-bridge.ts. chrome.storage.local key of the WalletConnect session summary the popup reads. */
export const STORAGE_KEY_WC_SESSION_SUMMARY = 'nom-wallet-wc-session-summary'
/** walletconnect-session-meta.ts. Storage-adapter key of each WalletConnect session's verify status and approval time. */
export const STORAGE_KEY_WC_SESSION_META = 'nom-wallet-wc-session-meta'
/** walletconnect-bridge.ts. chrome.storage.session key of the pending pair or end command for the WalletConnect window. */
export const SESSION_KEY_WALLETCONNECT_COMMAND = 'nom-wallet.walletConnectCommand'
/** walletconnect-bridge.ts. chrome.storage.session key of the last popup pair command's result. */
export const SESSION_KEY_WALLETCONNECT_PAIR_RESULT = 'nom-wallet.walletConnectPairResult'

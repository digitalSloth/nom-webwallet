/**
 * Centralized application configuration: network parameters, on-chain
 * constants, defaults, and feature flags. Prefer importing from here over
 * hardcoding magic numbers/URLs in components.
 */

// --- Node / network defaults ---
export const DEFAULT_NODE_URL = 'wss://node.zenonhub.io:35998'

// --- Network storage keys ---
export const STORAGE_KEY_SELECTED_NODE = 'nom-wallet-selected-node'
export const STORAGE_KEY_CHAIN_ID = 'nom-wallet-chain-id'
export const STORAGE_KEY_NETWORK_ID = 'nom-wallet-network-id'

/** Built-in node URLs offered in the network selector. */
export const DEFAULT_NODES: string[] = [DEFAULT_NODE_URL, 'wss://my.hc1node.com:35998']

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

// --- Wallet / security ---
/** Minimum password length for wallet encryption. */
export const MIN_PASSWORD_LENGTH = 12

/**
 * Minimum acceptable password-strength score (0–4) to create/import a wallet.
 * 2 = "Fair". See estimatePasswordStrength in core/password-strength.ts.
 */
export const MIN_PASSWORD_SCORE = 2

/** Human labels for the 0–4 password-strength score. */
export const PASSWORD_STRENGTH_LABELS = [
  'Very weak',
  'Weak',
  'Fair',
  'Good',
  'Strong'
] as const

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
  parallelism: 4
} as const

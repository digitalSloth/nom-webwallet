// KeyFile encrypted data structure from znn-typescript-sdk
export interface KeyFileEncryptedData {
  baseAddress: string
  crypto: {
    argon2Params: {
      salt: string
    }
    cipherData: string
    cipherName: string
    kdf: string
    nonce: string
  }
  timestamp: number
  version: number
}

// Individual derived account from a wallet
export interface WalletAccount {
  address: string
  index: number
  label?: string
  hidden?: boolean
}

// Complete wallet with encrypted keyfile
export interface Wallet {
  name: string
  baseAddress: string
  encryptedKeyFile: KeyFileEncryptedData
  accounts: WalletAccount[]
  createdAt: number
}

// Storage structure for all wallets
export interface WalletStorage {
  wallets: Wallet[]
  activeWalletAddress: string | null
  activeAccountAddress: string | null
}

// Generic storage adapter interface
export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

// Token balance information
export interface BalanceInfo {
  tokenStandard: string
  balance: string
  decimals: number
  symbol?: string
  name?: string
}

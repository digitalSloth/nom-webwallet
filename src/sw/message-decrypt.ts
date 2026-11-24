import { mnemonicToSeedSync, entropyToMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { ed25519 } from '@noble/curves/ed25519'
import { hmac } from '@noble/hashes/hmac'
import { sha3_256 } from '@noble/hashes/sha3'
import { sha512 } from '@noble/hashes/sha2'
import { bech32 } from 'bech32'
import {
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_PREFIX_UNLOCKED,
  STORAGE_KEY_WALLETS,
} from '@/config'
import { isActivityExpired, readAutoLockMinutes } from '@/core/auto-lock-policy'
import {
  ERR_NOT_CONNECTED,
  ERR_WALLET_UNAVAILABLE,
  type ProviderError,
} from '@/core/inpage-protocol'
import { openMessage, type MessageToOpen, type OpenedMessage } from '@/core/message-envelope'
import { openInscription, type OpenedInscription, type SealedToOpen } from '@/core/sealed-box'
import { canReadMessages } from '@/core/site-permissions'
import type { WalletStorage } from '@/types'

/**
 * Decrypts messages and sealed inscriptions for a granted origin inside the service worker. The
 * account key is derived here from the entropy in the key cache
 * (chrome.storage.session), so the worker stays SDK-free and no key
 * material ever reaches a page: the page passes ciphertext in and gets
 * plaintext back. The function only reads storage. It never writes, so a
 * decrypt can never extend the auto-lock time, and it never logs.
 */

const HARDENED = 0x80000000
const SLIP10_KEY = new TextEncoder().encode('ed25519 seed')
// The SDK's Derivation: m/44'/73404'/{index}'
const DERIVATION_PREFIX = [44, 73404]
const ADDRESS_PREFIX = 'z'
const USER_ADDRESS_BYTE = 0
const ADDRESS_DIGEST_BYTES = 19

/** SLIP-10 Ed25519 private key at `m/44'/73404'/{index}'` for a wallet's entropy (hex). */
export function deriveAccountSeed(entropyHex: string, index: number): Uint8Array {
  const entropy = new Uint8Array(entropyHex.length / 2)
  for (let i = 0; i < entropy.length; i++) {
    entropy[i] = parseInt(entropyHex.slice(i * 2, i * 2 + 2), 16)
  }
  const mnemonic = entropyToMnemonic(entropy, wordlist)
  entropy.fill(0)
  const seed = mnemonicToSeedSync(mnemonic)
  let digest = hmac(sha512, SLIP10_KEY, seed)
  seed.fill(0)
  for (const step of [...DERIVATION_PREFIX, index]) {
    const data = new Uint8Array(37)
    data.set(digest.subarray(0, 32), 1)
    new DataView(data.buffer).setUint32(33, (step + HARDENED) >>> 0)
    const next = hmac(sha512, digest.subarray(32), data)
    digest.fill(0)
    data.fill(0)
    digest = next
  }
  const key = digest.slice(0, 32)
  digest.fill(0)
  return key
}

/** The account address (bech32) of an Ed25519 public key. */
export function addressOfPublicKey(publicKey: Uint8Array): string {
  const core = new Uint8Array(1 + ADDRESS_DIGEST_BYTES)
  core[0] = USER_ADDRESS_BYTE
  core.set(sha3_256(publicKey).subarray(0, ADDRESS_DIGEST_BYTES), 1)
  return bech32.encode(ADDRESS_PREFIX, bech32.toWords(core))
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64ToBytes(data: string): Uint8Array | null {
  try {
    const binary = atob(data)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

const notGranted: ProviderError = {
  code: ERR_NOT_CONNECTED,
  message: 'Message access is not granted for this account.',
}
const locked: ProviderError = { code: ERR_WALLET_UNAVAILABLE, message: 'Wallet is locked.' }

/**
 * The one gate in front of every decrypt: the stored active account, the
 * grant for that account, the unlock and the auto-lock time. `run` gets the
 * account seed and public key and the seed is wiped afterwards. Anything
 * `run` throws is reported as locked, so no detail leaks.
 */
async function withAccountKey<T>(
  origin: string,
  run: (seed: Uint8Array, ownPublicKey: Uint8Array) => T
): Promise<{ result: T } | { error: ProviderError }> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_WALLETS)
  const data = stored[STORAGE_KEY_WALLETS] as WalletStorage | undefined
  const account = data?.activeAccountAddress
  const wallet = data?.wallets.find((w) => w.accounts.some((a) => a.address === account))
  const accountIndex = wallet?.accounts.find((a) => a.address === account)?.index
  if (!data || !account || !wallet || accountIndex === undefined) {
    return { error: { code: ERR_WALLET_UNAVAILABLE, message: 'No wallet exists.' } }
  }

  if (!(await canReadMessages(origin, account))) return { error: notGranted }

  const keyName = SESSION_KEY_PREFIX_UNLOCKED + wallet.baseAddress
  const [session, minutes] = await Promise.all([
    chrome.storage.session.get([keyName, SESSION_KEY_LAST_ACTIVITY]),
    readAutoLockMinutes(),
  ])
  const entropy = session[keyName]
  const lastActivity = session[SESSION_KEY_LAST_ACTIVITY]
  if (
    typeof entropy !== 'string' ||
    isActivityExpired(
      typeof lastActivity === 'number' ? lastActivity : undefined,
      Date.now(),
      minutes * 60_000
    )
  ) {
    return { error: locked }
  }

  let seed: Uint8Array | null = null
  try {
    seed = deriveAccountSeed(entropy, accountIndex)
    const ownPublicKey = ed25519.getPublicKey(seed)
    // A cache entry that does not yield the active account is as good as locked.
    if (addressOfPublicKey(ownPublicKey) !== account) return { error: locked }
    return { result: run(seed, ownPublicKey) }
  } catch {
    return { error: locked }
  } finally {
    seed?.fill(0)
  }
}

export function decryptForOrigin(
  origin: string,
  items: MessageToOpen[]
): Promise<{ result: OpenedMessage[] } | { error: ProviderError }> {
  return withAccountKey(origin, (seed, ownPublicKey) =>
    items.map((item): OpenedMessage => {
      const envelope = base64ToBytes(item.data)
      if (!envelope) return { ok: false, reason: 'notMessage' }
      return openMessage({
        ownSeed: seed,
        ownPublicKey,
        counterpartyPublicKey: hexToBytes(item.publicKey),
        envelope,
        outgoing: item.outgoing,
      })
    })
  )
}

export function decryptInscriptionsForOrigin(
  origin: string,
  items: SealedToOpen[]
): Promise<{ result: OpenedInscription[] } | { error: ProviderError }> {
  return withAccountKey(origin, (seed, ownPublicKey) =>
    items.map((item) => openInscription({ ownSeed: seed, ownPublicKey, payload: item.payload }))
  )
}

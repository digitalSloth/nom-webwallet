import { addressOfPublicKey, deriveAccountSeed } from '@/sw/message-decrypt'
import { ed25519 } from '@noble/curves/ed25519'

/** Fixed wallet entropy (hex) for tests that need a real account key. */
export const TEST_ENTROPY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
export const OTHER_ENTROPY = 'f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100'

export interface TestAccount {
  index: number
  seed: Uint8Array
  publicKey: Uint8Array
  address: string
}

export function testAccount(entropy: string, index: number): TestAccount {
  const seed = deriveAccountSeed(entropy, index)
  const publicKey = ed25519.getPublicKey(seed)
  return { index, seed, publicKey, address: addressOfPublicKey(publicKey) }
}

/** The wallet storage blob for one wallet whose accounts are `indexes` of `entropy`, with `active` selected. */
export function walletStorage(entropy: string, indexes: number[], active: number) {
  const accounts = indexes.map((index) => ({
    index,
    address: testAccount(entropy, index).address,
  }))
  const baseAddress = testAccount(entropy, 0).address
  return {
    wallets: [{ baseAddress, accounts }],
    activeWalletAddress: baseAddress,
    activeAccountAddress: testAccount(entropy, active).address,
  }
}

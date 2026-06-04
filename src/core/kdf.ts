import { KeyFile } from 'znn-typescript-sdk'
import type { KdfParams } from '@/config'

// The SDK reads a static `KeyFile.DEFAULT_CONFIG` (typed `private static readonly`)
// at hash time and does not persist KDF params in the keyfile. We therefore set
// the params around each encrypt/decrypt and restore them afterward. The cast is
// required because the field is private/readonly in the typings; at runtime it is
// a plain writable static. Confined to this module.
type KdfConfig = KdfParams & { type: number }
const keyFileStatic = KeyFile as unknown as { DEFAULT_CONFIG: KdfConfig }

/**
 * Run `fn` with the SDK's Argon2id parameters set to `params`, restoring the
 * previous config afterward. Wallet operations are user-driven and serial, so
 * there is no concurrent encrypt/decrypt with differing params.
 */
export async function withKdfParams<T>(params: KdfParams, fn: () => Promise<T>): Promise<T> {
  const previous = keyFileStatic.DEFAULT_CONFIG
  keyFileStatic.DEFAULT_CONFIG = { ...params, type: 2 } // 2 = Argon2id
  try {
    return await fn()
  } finally {
    keyFileStatic.DEFAULT_CONFIG = previous
  }
}

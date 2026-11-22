import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa'
import { u32, u8 } from '@noble/ciphers/utils'
import { edwardsToMontgomeryPub, x25519 } from '@noble/curves/ed25519'
import { blake2b } from '@noble/hashes/blake2b'
import sodium from 'libsodium-wrappers'

const SIGMA = Uint32Array.of(0x61707865, 0x3320646e, 0x79622d32, 0x6b206574)

/** ISO/IEC 7816-4 padding to a multiple of 32 bytes. */
export function pad32(content: Uint8Array): Uint8Array {
  const padded = new Uint8Array((Math.floor(content.length / 32) + 1) * 32)
  padded.set(content)
  padded[content.length] = 0x80
  return padded
}

/**
 * Test-only sealer built from noble primitives, the inverse of `openSealed`.
 * `ephemeralPublic` overrides the public key written to the box, which lets
 * a test seal under a key the wallet must refuse.
 */
export function sealWithNoble(
  padded: Uint8Array,
  recipientEd25519: Uint8Array,
  ephemeralSecret: Uint8Array = x25519.utils.randomPrivateKey(),
  ephemeralPublic: Uint8Array = x25519.getPublicKey(ephemeralSecret)
): Uint8Array {
  const recipient = edwardsToMontgomeryPub(recipientEd25519)
  const shared = x25519.getSharedSecret(ephemeralSecret, recipient)
  const derived = new Uint32Array(8)
  hsalsa(SIGMA, u32(shared), new Uint32Array(4), derived)
  const nonce = blake2b(Uint8Array.from([...ephemeralPublic, ...recipient]), { dkLen: 24 })
  const boxed = xsalsa20poly1305(u8(derived), nonce).encrypt(padded)
  return Uint8Array.from([...ephemeralPublic, ...boxed])
}

/** libsodium `crypto_box_seal` of `content` (padded here) to an Ed25519 key, standard base64. */
export async function sodiumSealPayload(
  content: string | Uint8Array,
  recipientEd25519: Uint8Array
): Promise<string> {
  await sodium.ready
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const sealed = sodium.crypto_box_seal(
    sodium.pad(bytes, 32),
    sodium.crypto_sign_ed25519_pk_to_curve25519(recipientEd25519)
  )
  return Buffer.from(sealed).toString('base64')
}

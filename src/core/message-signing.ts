import { Buffer } from 'buffer'
import type { KeyPair } from 'znn-typescript-sdk'
import { encodeMessage, InvalidParamsError, messageProblem } from './message-guard'

/**
 * Page-only signing entry point for the dApp surfaces. The wallet, never the
 * dApp, chooses which key signs — callers pass the active account's keypair.
 */
export function signMessage(
  message: string,
  keyPair: KeyPair
): { signature: string; publicKey: string } {
  const problem = messageProblem(message)
  if (problem) throw new InvalidParamsError(problem)

  return {
    signature: keyPair.sign(Buffer.from(encodeMessage(message))).toString('hex'),
    publicKey: keyPair.getPublicKey().toString('hex'),
  }
}

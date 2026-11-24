import { AccountBlockTemplate, Address, ZNN_ZTS, type KeyPair } from 'znn-typescript-sdk'
import { Buffer } from 'buffer'
import type { ApprovalAction } from './dapp-approvals'
import { sealMessage } from './message-envelope'

/**
 * The send block of an encrypted message: ZNN, amount 0, the envelope as
 * data. Runs only in the trusted context that signs, from the content the
 * approval screen showed; the page never sees a key.
 */
export function sealMessageBlock(
  action: Extract<ApprovalAction, { kind: 'sendMessage' }>,
  keyPair: KeyPair,
  chainIdentifier: number
): AccountBlockTemplate {
  const envelope = sealMessage({
    ownSeed: keyPair.privateKey,
    ownPublicKey: keyPair.publicKey,
    counterpartyPublicKey: Uint8Array.from(Buffer.from(action.recipientPublicKey, 'hex')),
    content: action.content,
  })
  return new AccountBlockTemplate({
    blockType: 2,
    toAddress: Address.parse(action.to),
    tokenStandard: ZNN_ZTS,
    amount: 0n,
    data: Buffer.from(envelope),
    chainIdentifier,
  })
}

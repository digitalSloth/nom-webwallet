import { AccountBlockTemplate, Address, Hash, TokenStandard } from 'znn-typescript-sdk'
import { Buffer } from 'buffer'
import { accountBlockProblem, sendTransactionParamsProblem } from './account-block-validation'
import { InvalidParamsError } from './message-guard'

export { InvalidParamsError } from './message-guard'

/**
 * Constructs `AccountBlockTemplate`s directly from validated dApp JSON — never
 * via `fromJson`, which throws on a partial block and would let a dApp-chosen
 * `version`/`chainIdentifier` reach the signed digest. The caller passes the
 * chain id the approval is bound to (see PendingApproval.chainId).
 */

/** Throws InvalidParamsError when the JSON is not a usable account block. */
export function parseAccountBlockJson(json: unknown, chainIdentifier: number): AccountBlockTemplate {
  const problem = accountBlockProblem(json)
  if (problem) throw new InvalidParamsError(problem)

  const block = json as Record<string, unknown>

  if (block.blockType === 2) {
    return new AccountBlockTemplate({
      blockType: 2,
      toAddress: Address.parse(block.toAddress as string),
      tokenStandard: TokenStandard.parse(block.tokenStandard as string),
      amount: BigInt(String(block.amount)),
      data: block.data ? Buffer.from(block.data as string, 'base64') : Buffer.from([]),
      chainIdentifier,
    })
  }

  // blockType 3 — receive. Nothing else, whatever else the dApp sent.
  return new AccountBlockTemplate({
    blockType: 3,
    fromBlockHash: Hash.parse(block.fromBlockHash as string),
    chainIdentifier,
  })
}

/** Throws InvalidParamsError when the params are not a usable {to, tokenStandard, amount}. */
export function parseSendTransactionParams(
  params: unknown,
  chainIdentifier: number
): AccountBlockTemplate {
  const problem = sendTransactionParamsProblem(params)
  if (problem) throw new InvalidParamsError(problem)

  const p = params as Record<string, unknown>

  return new AccountBlockTemplate({
    blockType: 2,
    toAddress: Address.parse(p.to as string),
    tokenStandard: TokenStandard.parse(p.tokenStandard as string),
    amount: BigInt(String(p.amount)),
    data: Buffer.from([]),
    chainIdentifier,
  })
}

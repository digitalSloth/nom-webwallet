import { AccountBlockTemplate, Address, Hash, TokenStandard } from 'znn-typescript-sdk'
import { Buffer } from 'buffer'
import { ZenonService } from './zenon-service'
import { accountBlockProblem, sendTransactionParamsProblem } from './account-block-validation'
import { InvalidParamsError } from './message-guard'

export { InvalidParamsError } from './message-guard'

/**
 * Constructs `AccountBlockTemplate`s directly from validated dApp JSON — never
 * via `fromJson`, which throws on a partial block and would let a dApp-chosen
 * `version`/`chainIdentifier` reach the signed digest. Callers must
 * `await ZenonService.getInstance().ensureInitialized()` first, so the chain ID
 * read here is the persisted one.
 */

/** Throws InvalidParamsError when the JSON is not a usable account block. */
export function parseAccountBlockJson(json: unknown): AccountBlockTemplate {
  const problem = accountBlockProblem(json)
  if (problem) throw new InvalidParamsError(problem)

  const block = json as Record<string, unknown>
  const chainIdentifier = ZenonService.getInstance().getChainId()

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
export function parseSendTransactionParams(params: unknown): AccountBlockTemplate {
  const problem = sendTransactionParamsProblem(params)
  if (problem) throw new InvalidParamsError(problem)

  const p = params as Record<string, unknown>

  return new AccountBlockTemplate({
    blockType: 2,
    toAddress: Address.parse(p.to as string),
    tokenStandard: TokenStandard.parse(p.tokenStandard as string),
    amount: BigInt(String(p.amount)),
    data: Buffer.from([]),
    chainIdentifier: ZenonService.getInstance().getChainId(),
  })
}

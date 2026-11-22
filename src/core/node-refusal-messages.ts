/**
 * go-zenon refusal messages that a node returns under code -32000 before it
 * inserts or broadcasts a published block. A -32000 with any other message
 * (a proxy timeout, an unknown text, "method handler crashed") is not
 * treated as a refusal, because it can follow a block that was applied.
 *
 * Source, go-zenon commit bb39e31c608dc397a91b98b21b096bca99a9f4d6:
 * - verifier/errors.go:20-65 (account-block verification; `ErrVerifierInternal`
 *   at :18 is wrapped as "<message> - <detail>")
 * - vm/constants/errors.go:6,11,16-17,19,21,40-41,48-50,65-66 (VM panic
 *   recovered inside `Supervisor.applyBlock`, balance, plasma, parameter,
 *   token and HTLC argument errors)
 * - vm/embedded/implementation/token.go:26-66 (`checkToken`) and :77-92,
 *   :163-173,:246-254,:295-304, htlc.go:37-47 (`checkHtlc`) and :57-73,
 *   :128-137,:197-206,:288-296,:327-335: the `ValidateSendBlock` methods
 *   that return these token and HTLC texts
 * - rpc/api/ledger.go:50 (chain id), :62 (no momentum), rpc/api/errors.go:12
 * - rpc/api/utils.go:53 (unknown token standard)
 * All of these return from `PublishRawTransaction` before
 * `Broadcaster().CreateAccountBlock` (rpc/api/ledger.go:72).
 */
export const NODE_REFUSAL_MESSAGES: readonly string[] = [
  'account-block version is missing',
  'account-block version is invalid',
  'account-block chain-identifier is missing',
  'account-block chain-identifier mismatch (belongs to another chain)',
  'account-block type is invalid (batched blocks should not exist as stand-alone)',
  'account-block type is missing',
  'account-block type must not be genesis',
  'account-block type is not supported',
  'account-block type is not suitable for contracts',
  'account-block type is not suitable for user-blocks',
  'account-block height must be higher than 0',
  'account-block prevHeight is cemented but has different hash',
  'account-block prevHash exists but it has a cemented block on top of it',
  'account-block prevHash must not be zero',
  'account-block prevHash must be zero',
  "account-block amount can't be negative",
  'account-block amount is too big',
  'account-block amount must be zero',
  'account-block zts is missing (non-zero amount)',
  'account-block zts must be zero',
  'account-block to-address must be zero',
  'account-block hash must not be zero',
  'account-block hash is different than the one computed',
  'account-block data field is too big',
  "account-block publicKey doesn't correspond to the address",
  'account-block publicKey is missing',
  'account-block publicKey must be zero',
  'account-block signature is invalid',
  'account-block signature is missing',
  'account-block signature must be zero',
  'account-block nonce/difficulty is invalid',
  'account-block descendant blocks must be empty',
  'account-block descendant block failed to pass verifications',
  'account-block previous block is missing',
  'account-block momentum-acknowledged points to an older momentum than previous',
  'account-block momentum-acknowledged must have the same value for batched blocks',
  'account-block momentum-acknowledged points to invalid momentum for auto-generated blocks',
  'account-block momentum-acknowledged points to missing momentum',
  'account-block momentum-acknowledged missing',
  'account-block from-block-hash is nor provided',
  'account-block from-block-hash must be zero',
  "account-block from-block doesn't exist",
  'account-block from-block already received',
  'account-block from-block receiver mismatch',
  'account-block failed to pass sequencer checks. Nothing to receive',
  'account-block failed to pass sequencer checks. Not next in line to receive',
  'internal error while verifying',
  'supervisor - VM panic',
  'insufficient balance for transfer',
  'invalid arguments',
  'forbidden parameter',
  'plasma limit for account-block reached',
  'not enough plasma on account',
  'not enough TotalPlasma provided for account-block (PoW + Fused)',
  'failed to get latest momentum',
  'parameter must not be null',
  'ts doesn’t exist',
  'invalid token name/symbol/domain/decimals',
  'invalid token total/max supply',
  'invalid token or amount',
  'invalid unpack method data',
  'invalid hash type',
  'invalid hash digest',
]

// rpc/api/ledger.go:50 formats the two chain ids into the message.
const CHAIN_MISMATCH_PREFIX = 'the block has a different network Id ('

/** True for a known refusal message, also when the node appends " - <detail>". */
export function isKnownRefusalMessage(message: unknown): boolean {
  if (typeof message !== 'string') return false
  if (message.startsWith(CHAIN_MISMATCH_PREFIX)) return true
  return NODE_REFUSAL_MESSAGES.some((m) => message === m || message.startsWith(`${m} - `))
}

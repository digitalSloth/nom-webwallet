import { ref } from 'vue'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountBlockTemplate, Token } from 'znn-typescript-sdk'
import type { Wallet } from '@/types'
import { sendContractCall } from '../contract-send'
import type { TxMeta } from '../send-recorder'
import { TokenService } from '../token-service'
import type { BurnParams, IssueParams, MintParams, UpdateParams } from '../token-service'

// Module-level reactive state, shared across every useOwnedTokens() caller
const owned = ref<Token[]>([])
const ownedFor = ref<string | null>(null)
const ownedCount = ref<number | null>(null)
const ownedCountFor = ref<string | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
let latestList = 0
let latestCount = 0

function issue(
  wallet: Wallet,
  from: string,
  params: IssueParams,
  meta: TxMeta
): Promise<AccountBlockTemplate> {
  return sendContractCall({
    wallet,
    from,
    block: TokenService.getInstance().issueBlock(params),
    meta,
    activity: 'Issuing token',
  })
}

export const TOKEN_CHANGED_MESSAGE =
  'This token changed since you opened this dialog. Review it again. Nothing was sent.'

// Re-reads the token right before a send. Throws, with nothing sent, when the node cannot answer.
async function readToken(zts: string): Promise<Token | null> {
  try {
    return await TokenService.getInstance().findToken(zts)
  } catch {
    throw new Error("Couldn't read this token from the node. Nothing was sent.")
  }
}

// Rules checked against go-zenon at bb39e31c, vm/embedded/implementation/token.go:
// Mint receive needs a mintable token, room under the max supply and the owner as sender.
async function mint(
  wallet: Wallet,
  from: string,
  p: MintParams,
  meta: TxMeta
): Promise<AccountBlockTemplate> {
  const t = await readToken(p.tokenStandard)
  if (
    !t ||
    t.owner.toString() !== from ||
    !t.isMintable ||
    t.maxSupply - t.totalSupply < p.amount
  ) {
    throw new Error(TOKEN_CHANGED_MESSAGE)
  }
  return sendContractCall({
    wallet,
    from,
    block: TokenService.getInstance().mintBlock(p),
    meta,
    activity: 'Minting tokens',
  })
}

// Burn receive needs a burnable token or the owner as sender; a failed receive refunds the amount.
async function burn(
  wallet: Wallet,
  from: string,
  p: BurnParams,
  meta: TxMeta
): Promise<AccountBlockTemplate> {
  if (p.tokenStandard === ZNN_ZTS.toString() || p.tokenStandard === QSR_ZTS.toString()) {
    throw new Error("ZNN and QSR can't be burned from this wallet. Nothing was sent.")
  }
  const t = await readToken(p.tokenStandard)
  if (!t || (!t.isBurnable && t.owner.toString() !== from)) throw new Error(TOKEN_CHANGED_MESSAGE)
  return sendContractCall({
    wallet,
    from,
    block: TokenService.getInstance().burnBlock(p),
    meta,
    activity: 'Burning tokens',
  })
}

// UpdateToken receive needs the owner as sender, and minting cannot be turned back on.
async function update(
  wallet: Wallet,
  from: string,
  p: UpdateParams,
  loaded: { owner: string; mintable: boolean; burnable: boolean },
  meta: TxMeta
): Promise<AccountBlockTemplate> {
  const t = await readToken(p.tokenStandard)
  if (
    !t ||
    t.owner.toString() !== from ||
    t.owner.toString() !== loaded.owner ||
    t.isMintable !== loaded.mintable ||
    t.isBurnable !== loaded.burnable
  ) {
    throw new Error(TOKEN_CHANGED_MESSAGE)
  }
  if (p.mintable && !t.isMintable)
    throw new Error("Minting can't be turned back on. Nothing was sent.")
  return sendContractCall({
    wallet,
    from,
    block: TokenService.getInstance().updateBlock(p),
    meta,
    activity: 'Updating token',
  })
}

export function useOwnedTokens() {
  const tokenService = TokenService.getInstance()

  async function loadOwned(address: string): Promise<void> {
    const list = ++latestList
    const count = ++latestCount
    isLoading.value = true
    error.value = null

    try {
      const result = await tokenService.getByOwner(address)
      // A newer load owns each field; an older response must not overwrite it.
      if (list === latestList) {
        owned.value = result.list
        ownedFor.value = address
      }
      if (count === latestCount) {
        ownedCount.value = result.count
        ownedCountFor.value = address
      }
    } catch (err) {
      if (list === latestList) {
        error.value = err instanceof Error ? err.message : 'Failed to load tokens'
        console.error('Failed to load tokens:', err)
        owned.value = []
        ownedFor.value = null
      }
    } finally {
      if (list === latestList) isLoading.value = false
    }
  }

  // Reads one row to get the node's total, without touching the list.
  async function loadOwnedCount(address: string): Promise<void> {
    const count = ++latestCount
    try {
      const result = await tokenService.getByOwner(address, 0, 1)
      if (count !== latestCount) return
      ownedCount.value = result.count
      ownedCountFor.value = address
    } catch {
      if (count !== latestCount) return
      ownedCount.value = null
      ownedCountFor.value = null
    }
  }

  function findToken(zts: string): Promise<Token | null> {
    return tokenService.findToken(zts)
  }

  return {
    owned,
    ownedFor,
    ownedCount,
    ownedCountFor,
    isLoading,
    error,
    loadOwned,
    loadOwnedCount,
    findToken,
    issue,
    mint,
    burn,
    update,
  }
}

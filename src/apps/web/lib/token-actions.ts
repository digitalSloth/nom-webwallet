import { Address, QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { Token } from 'znn-typescript-sdk'
import { isEmbeddedContract } from '@/core/contract-call'
import { formatAmount, parseAmount } from '@/shared/lib/amount'
import type { BurnParams, MintParams, TxMeta, UpdateParams } from '@/core'
import type { BalanceInfo } from '@/types'
import { groupedAmount } from './owned-tokens'
import { tokenRows } from './token-rows'

export type TokenActionMode = 'mint' | 'burn' | 'manage'

/** The token fields the dialog decides on, read once from an SDK Token. */
export interface TokenFacts {
  tokenStandard: string
  name: string
  symbol: string
  decimals: number
  owner: string
  totalSupply: bigint // raw
  maxSupply: bigint // raw
  isMintable: boolean
  isBurnable: boolean
}

export function tokenFacts(t: Token): TokenFacts {
  return {
    tokenStandard: t.tokenStandard.toString(),
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    owner: t.owner.toString(),
    totalSupply: t.totalSupply,
    maxSupply: t.maxSupply,
    isMintable: t.isMintable,
    isBurnable: t.isBurnable,
  }
}

/** The lower-case form of a valid address, or null. */
export function canonicalAddress(text: string): string | null {
  try {
    return Address.parse(text.trim()).toString()
  } catch {
    return null
  }
}

/** Expects a canonical address, so an upper-case contract address is still caught. */
export function addressWarning(
  address: string,
  ownAccounts: readonly string[]
): 'contract' | 'foreign' | null {
  if (isEmbeddedContract(address)) return 'contract'
  return ownAccounts.includes(address) ? null : 'foreign'
}

export function canBurn(t: TokenFacts, active: string): boolean {
  return t.isBurnable || t.owner === active
}

/** The raw balance of `zts`, or null while the balances are still loading. */
export function heldBalance(
  balances: readonly BalanceInfo[],
  zts: string,
  loading: boolean
): bigint | null {
  if (loading && balances.length === 0) return null
  const entry = balances.find((b) => b.tokenStandard === zts)
  return entry ? BigInt(entry.balance) : 0n
}

/** Held tokens above zero, without ZNN and QSR (matched by standard). */
export function burnChoices(balances: readonly BalanceInfo[]): BalanceInfo[] {
  const znn = ZNN_ZTS.toString()
  const qsr = QSR_ZTS.toString()
  return tokenRows([...balances], '').filter(
    (b) => b.tokenStandard !== znn && b.tokenStandard !== qsr
  )
}

export function actionKey(mode: TokenActionMode, from: string, zts: string): string {
  const name = mode === 'manage' ? 'update' : mode
  return `token-${name}:${from}:${zts}`
}

const NOT_VALID_ADDRESS = 'Enter a valid z1 address'

function amountError(parsed: bigint | null, decimals: number): string | null {
  if (parsed === null) return `Enter a valid amount (up to ${decimals} decimals)`
  return parsed === 0n ? 'Enter an amount above 0' : null
}

export interface MintCheck {
  params: MintParams | null
  errors: { amount?: string; to?: string }
  blocked: string | null // no mint is possible: the CTA stays disabled
  remaining: bigint // maxSupply - totalSupply, never below 0n
  toWarning: string | null
}

// Rules checked against go-zenon at bb39e31c, vm/embedded/implementation/token.go:
// MintMethod.ReceiveBlock needs the owner, a mintable token and room under the max supply.
export function parseMint(
  form: { amount: string; to: string },
  t: TokenFacts,
  ctx: { active: string; ownAccounts: readonly string[] }
): MintCheck {
  const remaining = t.maxSupply > t.totalSupply ? t.maxSupply - t.totalSupply : 0n
  const errors: MintCheck['errors'] = {}
  let blocked: string | null = null
  if (t.owner !== ctx.active) blocked = 'You no longer own this token.'
  else if (!t.isMintable) blocked = "This token isn't mintable."
  else if (remaining === 0n) blocked = 'This token is at its max supply.'

  const amountText = form.amount.trim()
  let amount: bigint | null = null
  if (amountText !== '') {
    const parsed = parseAmount(amountText, t.decimals)
    const bad = amountError(parsed, t.decimals)
    if (bad) errors.amount = bad
    else if (parsed !== null && parsed > remaining) {
      errors.amount = `Only ${groupedAmount(remaining, t.decimals)} ${t.symbol} can still be minted`
    } else amount = parsed
  }

  const toText = form.to.trim()
  let receiveAddress: string | null = null
  let toWarning: string | null = null
  if (toText !== '') {
    const canonical = canonicalAddress(toText)
    if (canonical === null) errors.to = NOT_VALID_ADDRESS
    else {
      const warning = addressWarning(canonical, ctx.ownAccounts)
      if (warning === 'contract') errors.to = "Tokens can't be minted to a contract address."
      else {
        receiveAddress = canonical
        if (warning === 'foreign') {
          toWarning =
            "This address isn't one of your accounts. Minted tokens sent to a wrong address are lost."
        }
      }
    }
  }

  const params =
    !blocked && amount !== null && receiveAddress !== null && !errors.amount && !errors.to
      ? { tokenStandard: t.tokenStandard, amount, receiveAddress }
      : null
  return { params, errors, blocked, remaining, toWarning }
}

export interface BurnCheck {
  params: BurnParams | null
  error: string | null
  blocked: string | null
  reducesMax: boolean // !t.isMintable
}

// Rules checked against go-zenon at bb39e31c: BurnMethod.ReceiveBlock needs a burnable
// token or the owner, and lowers the max supply of a token that is not mintable.
export function parseBurn(
  amount: string,
  t: TokenFacts,
  balance: bigint | null,
  active: string
): BurnCheck {
  const reducesMax = !t.isMintable
  let blocked: string | null = null
  if (t.tokenStandard === ZNN_ZTS.toString() || t.tokenStandard === QSR_ZTS.toString()) {
    blocked = "ZNN and QSR can't be burned from this wallet."
  } else if (!canBurn(t, active)) blocked = 'Only the owner can burn this token.'

  const text = amount.trim()
  if (text === '') return { params: null, error: null, blocked, reducesMax }
  const parsed = parseAmount(text, t.decimals)
  const bad = amountError(parsed, t.decimals)
  if (bad || parsed === null) return { params: null, error: bad, blocked, reducesMax }
  if (balance === null) return { params: null, error: null, blocked, reducesMax }
  if (parsed > balance) {
    return { params: null, error: 'Insufficient balance', blocked, reducesMax }
  }
  const params = blocked ? null : { tokenStandard: t.tokenStandard, amount: parsed }
  return { params, error: null, blocked, reducesMax }
}

export interface UpdateForm {
  owner: string
  mintable: boolean
  burnable: boolean
  confirmedOwner: string | null
  mintOffConfirmed: boolean
}

export interface UpdateCheck {
  params: UpdateParams | null // every field valid
  errors: { owner?: string; mintable?: string }
  blocked: string | null
  ownerChanged: boolean
  disablesMint: boolean
  burnableChanged: boolean
  changed: boolean
  ownerWarning: string | null
  ready: boolean // params set, changed, and every needed confirmation given
}

// Rules checked against go-zenon at bb39e31c: UpdateTokenMethod.ReceiveBlock needs the owner,
// refuses turning minting back on, and sets MaxSupply = TotalSupply when minting turns off.
export function checkUpdate(
  form: UpdateForm,
  t: TokenFacts,
  ctx: { active: string; ownAccounts: readonly string[] }
): UpdateCheck {
  const errors: UpdateCheck['errors'] = {}
  const blocked = t.owner !== ctx.active ? 'You no longer own this token.' : null

  const ownerText = form.owner.trim()
  const canonical = ownerText === '' ? null : canonicalAddress(ownerText)
  let ownerWarning: string | null = null
  let ownerChanged = false
  if (ownerText !== '' && canonical === null) errors.owner = NOT_VALID_ADDRESS
  if (canonical !== null) {
    const warning = addressWarning(canonical, ctx.ownAccounts)
    ownerChanged = canonical !== t.owner
    if (warning === 'contract') errors.owner = "A contract address can't own a token."
    else if (ownerChanged && warning === 'foreign') {
      ownerWarning =
        "This address isn't one of your accounts. After this change, only its holder can mint and manage this token."
    }
  }
  if (form.mintable && !t.isMintable) errors.mintable = "Minting can't be turned back on."

  const disablesMint = t.isMintable && !form.mintable
  const burnableChanged = form.burnable !== t.isBurnable
  const changed = ownerChanged || disablesMint || burnableChanged
  const params =
    !blocked && !errors.owner && !errors.mintable && canonical !== null
      ? {
          tokenStandard: t.tokenStandard,
          owner: canonical,
          mintable: form.mintable,
          burnable: form.burnable,
        }
      : null
  const ready =
    params !== null &&
    changed &&
    (!ownerChanged || form.confirmedOwner === params.owner) &&
    (!disablesMint || form.mintOffConfirmed)
  return {
    params,
    errors,
    blocked,
    ownerChanged,
    disablesMint,
    burnableChanged,
    changed,
    ownerWarning,
    ready,
  }
}

export function mintMeta(p: MintParams, t: TokenFacts): TxMeta {
  const amt = formatAmount(p.amount, t.decimals)
  return {
    kind: 'contract',
    title: `Token · Mint ${amt} ${t.symbol}`,
    progress: `Minting ${amt} ${t.symbol}`,
    amount: p.amount.toString(),
    decimals: t.decimals,
    symbol: t.symbol,
    tokenStandard: p.tokenStandard,
    recipient: p.receiveAddress,
  }
}

export function burnMeta(p: BurnParams, t: TokenFacts): TxMeta {
  const amt = formatAmount(p.amount, t.decimals)
  return {
    kind: 'contract',
    title: `Token · Burn ${amt} ${t.symbol}`,
    progress: `Burning ${amt} ${t.symbol}`,
    amount: p.amount.toString(),
    decimals: t.decimals,
    symbol: t.symbol,
    tokenStandard: p.tokenStandard,
  }
}

export function updateMeta(p: UpdateParams, t: TokenFacts): TxMeta {
  return {
    kind: 'contract',
    title: `Token · Manage ${t.symbol}`,
    progress: `Updating ${t.symbol}`,
    ...(p.owner !== t.owner ? { recipient: p.owner } : {}),
  }
}

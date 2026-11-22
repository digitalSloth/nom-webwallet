import { ZNN_ZTS } from 'znn-typescript-sdk'
import { TOKEN_ISSUE_FEE } from '@/config'
import { parseAmount } from '@/shared/lib/amount'
import type { IssueParams, TxMeta } from '@/core'
import type { BalanceInfo } from '@/types'

export interface IssueForm {
  name: string
  symbol: string
  domain: string
  decimals: string
  totalSupply: string // whole-token text
  maxSupply: string // whole-token text, ignored when mintable is false
  mintable: boolean
  burnable: boolean
  utility: boolean
}

export type IssueField = keyof IssueForm | 'fee'

export interface IssueCheck {
  params: IssueParams | null // every rule passed: what Review shows and Issue sends
  errors: Partial<Record<IssueField, string>>
}

// Limits and patterns mirror go-zenon checkToken and
// IssueMethod.ValidateSendBlock at commit bb39e31c
// (vm/embedded/implementation/token.go, vm/constants/embedded.go,
// common/math.go).
// NAME_PATTERN is the linear form of the node's
// ^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$: both accept the strings of letters,
// digits and -._ that start and end with a letter or digit and never hold
// two separators in a row. The nested form backtracks exponentially in V8.
// The patterns accept ASCII only, so Go byte lengths and JavaScript UTF-16
// lengths agree on every string the node accepts.
export const NAME_PATTERN = /^[a-zA-Z0-9]+([-._][a-zA-Z0-9]+)*$/
const SYMBOL_PATTERN = /^[A-Z0-9]+$/
const DOMAIN_PATTERN = /^([A-Za-z0-9][A-Za-z0-9-]{0,61}[A-Za-z0-9]\.)+[A-Za-z]{2,}$/
const DECIMALS_PATTERN = /^[0-9]{1,2}$/
const NAME_MAX = 40 // TokenNameLengthMax
const SYMBOL_MAX = 10 // TokenSymbolLengthMax
const DOMAIN_MAX = 128 // TokenDomainLengthMax
const DECIMALS_MAX = 18 // TokenMaxDecimals
const TOKEN_MAX_SUPPLY = 2n ** 255n - 1n // TokenMaxSupplyBig

export function parseIssueForm(form: IssueForm, znnBalance: bigint | null): IssueCheck {
  const errors: IssueCheck['errors'] = {}
  const name = form.name.trim()
  const symbol = form.symbol.trim().toUpperCase()
  const domain = form.domain.trim()
  const decimalsText = form.decimals.trim()
  let missing = name === '' || symbol === '' || decimalsText === '' || form.totalSupply.trim() === ''
  if (form.mintable && form.maxSupply.trim() === '') missing = true

  if (name !== '') {
    if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters`
    else if (!NAME_PATTERN.test(name)) {
      errors.name = 'Use letters and numbers, with single - . _ only between them'
    }
  }

  if (symbol !== '') {
    if (symbol.length > SYMBOL_MAX) errors.symbol = `Use at most ${SYMBOL_MAX} characters`
    else if (!SYMBOL_PATTERN.test(symbol)) errors.symbol = 'Use only letters and numbers'
    else if (symbol === 'ZNN' || symbol === 'QSR') errors.symbol = 'ZNN and QSR are reserved'
  }

  if (domain !== '') {
    if (domain.length > DOMAIN_MAX) errors.domain = `Use at most ${DOMAIN_MAX} characters`
    else if (!DOMAIN_PATTERN.test(domain)) errors.domain = 'Enter a domain such as example.com'
  }

  let decimals: number | null = null
  if (decimalsText !== '') {
    if (DECIMALS_PATTERN.test(decimalsText) && Number(decimalsText) <= DECIMALS_MAX) {
      decimals = Number(decimalsText)
    } else {
      errors.decimals = `Enter a whole number from 0 to ${DECIMALS_MAX}`
    }
  }

  let total: bigint | null = null
  let max: bigint | null = null
  if (decimals !== null) {
    const amountError = `Enter a valid amount (up to ${decimals} decimals)`
    if (form.totalSupply.trim() !== '') {
      total = parseAmount(form.totalSupply, decimals)
      if (total === null) errors.totalSupply = amountError
    }
    if (form.mintable) {
      if (form.maxSupply.trim() !== '') {
        max = parseAmount(form.maxSupply, decimals)
        if (max === null) errors.maxSupply = amountError
      }
    } else {
      max = total
    }
  }

  if (total !== null && max !== null) {
    const supplyField = form.mintable ? 'maxSupply' : 'totalSupply'
    if (max === 0n) {
      errors[supplyField] = form.mintable
        ? 'Max supply must be above 0'
        : 'Initial supply must be above 0'
    } else if (max > TOKEN_MAX_SUPPLY) {
      errors[supplyField] = 'This supply is too large'
    } else if (form.mintable && max < total) {
      errors.maxSupply = 'Max supply must be at least the initial supply'
    }
  }

  if (znnBalance !== null && znnBalance < TOKEN_ISSUE_FEE) errors.fee = 'Issuing needs 1 ZNN'

  if (
    missing ||
    znnBalance === null ||
    decimals === null ||
    total === null ||
    max === null ||
    Object.keys(errors).length > 0
  ) {
    return { params: null, errors }
  }
  return {
    params: {
      name,
      symbol,
      domain,
      totalSupply: total,
      maxSupply: max,
      decimals,
      mintable: form.mintable,
      burnable: form.burnable,
      utility: form.utility,
    },
    errors,
  }
}

export function issueMeta(params: IssueParams): TxMeta {
  return {
    kind: 'contract',
    title: `Token · Issue ${params.symbol}`,
    progress: `Issuing ${params.symbol}`,
    amount: TOKEN_ISSUE_FEE.toString(),
    decimals: 8,
    symbol: 'ZNN',
    tokenStandard: ZNN_ZTS.toString(),
  }
}

export function permanentNote(mintable: boolean): string {
  return mintable
    ? 'Name, symbol, decimals, domain and the utility flag are permanent. You can turn minting off later, but never back on.'
    : 'Name, symbol, decimals, domain, the utility flag and the fixed supply are permanent. No one can ever mint more of this token.'
}

/** The raw ZNN balance, or null while the balances are still loading. */
export function znnBalanceOf(balances: readonly BalanceInfo[], loading: boolean): bigint | null {
  if (loading && balances.length === 0) return null
  const znn = balances.find((b) => b.tokenStandard === ZNN_ZTS.toString())
  return znn ? BigInt(znn.balance) : 0n
}

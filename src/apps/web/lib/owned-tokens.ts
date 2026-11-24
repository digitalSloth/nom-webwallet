import type { Token } from 'znn-typescript-sdk'
import { formatAmount } from '@/shared/lib/amount'

export interface OwnedRow {
  symbol: string
  name: string
  zts: string
  supply: string
  max: string
  flags: { label: string; on: boolean }[]
  canMint: boolean
}

// Groups the whole part with BigInt so large supplies never pass through Number.
export function groupedAmount(raw: bigint, decimals: number): string {
  const [whole, fraction] = formatAmount(raw, decimals).split('.')
  const grouped = BigInt(whole).toLocaleString('en-US')
  return fraction ? `${grouped}.${fraction}` : grouped
}

export function ownedRow(token: Token): OwnedRow {
  return {
    symbol: token.symbol,
    name: token.name,
    zts: token.tokenStandard.toString(),
    supply: groupedAmount(token.totalSupply, token.decimals),
    max: groupedAmount(token.maxSupply, token.decimals),
    canMint: token.isMintable && token.maxSupply > token.totalSupply,
    flags: [
      { label: token.isMintable ? 'Mintable' : 'Fixed supply', on: token.isMintable },
      { label: token.isBurnable ? 'Burnable' : 'Owner burns only', on: token.isBurnable },
      { label: token.isUtility ? 'Utility' : 'Not utility', on: token.isUtility },
    ],
  }
}

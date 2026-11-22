import { Address } from 'znn-typescript-sdk'

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/

/** Decimal text to raw base units, or null when the text is not a plain amount that fits. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const match = AMOUNT_PATTERN.exec(input.trim())
  if (!match) return null
  const fraction = match[2] ?? ''
  if (fraction.length > decimals) return null
  return BigInt(match[1] + fraction.padEnd(decimals, '0'))
}

/** Raw base units to decimal text without trailing zeros; the inverse of parseAmount. */
export function formatAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString()
  const digits = raw.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, -decimals)
  const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

/** `percent` of `balance`, rounded down to a base unit, as decimal text. */
export function amountShare(balance: bigint, percent: bigint, decimals: number): string {
  return formatAmount((balance * percent) / 100n, decimals)
}

/** Bech32 checksum, `z` prefix and length are all checked by the SDK parser. */
export function isValidAddress(value: string): boolean {
  try {
    Address.parse(value)
    return true
  } catch {
    return false
  }
}

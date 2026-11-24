import { MIN_STAKE_AMOUNT_ZNN } from '@/config'
import { parseAmount } from '@/shared/lib/amount'

/** Raw ZNN base units for the typed stake amount, or the text that explains why it is not valid. */
export function parseStakeAmount(
  text: string,
  available: bigint
): { raw: bigint | null; error: string | null } {
  if (text.trim() === '') return { raw: null, error: null }
  const raw = parseAmount(text, 8)
  if (raw === null) return { raw: null, error: 'Enter a valid amount (up to 8 decimals)' }
  if (raw < BigInt(MIN_STAKE_AMOUNT_ZNN) * 10n ** 8n) {
    return { raw: null, error: `Minimum is ${MIN_STAKE_AMOUNT_ZNN} ZNN` }
  }
  if (raw > available) return { raw: null, error: 'Insufficient ZNN balance' }
  return { raw, error: null }
}

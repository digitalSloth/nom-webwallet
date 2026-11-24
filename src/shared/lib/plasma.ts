import type { FusionEntry } from 'znn-typescript-sdk'
import { MIN_FUSE_AMOUNT_QSR, PLASMA_REVOKE_BLOCKS } from '@/config'
import { PLASMA_BOT_TIERS, PlasmaBotError } from '@/core/plasma-bot-service'
import type { PlasmaBotStats, PlasmaBotTierKey } from '@/core/plasma-bot-service'
import { parseAmount } from './amount'

export type PlasmaBotStatus = 'idle' | 'checking' | 'online' | 'unreachable'

/** Current plasma as a whole percent of the maximum, clamped to 0..100. */
export function plasmaPercent(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((current / max) * 100)))
}

/** The cheapest plazma.bot tier the bot can fund; the lowest tier while its status is unconfirmed. */
export function lowestAvailableTier(
  stats: PlasmaBotStats | null,
  status: PlasmaBotStatus
): PlasmaBotTierKey | null {
  if (status !== 'online') return PLASMA_BOT_TIERS[0].key
  if (!stats) return null
  return PLASMA_BOT_TIERS.find((t) => stats.availableTiers.includes(t.key))?.key ?? null
}

/** True once the frontier momentum has reached the fusion's expiration height. */
export function canCancelFusion(
  entry: Pick<FusionEntry, 'expirationHeight'>,
  frontierHeight: number
): boolean {
  return frontierHeight > 0 && frontierHeight >= entry.expirationHeight
}

/** The momentum height at which the fusion was made. */
export function fusedAtHeight(entry: Pick<FusionEntry, 'expirationHeight'>): number {
  return entry.expirationHeight - PLASMA_REVOKE_BLOCKS
}

/** Whole-QSR input to raw units, with the first validation error for the amount. */
export function parseFuseAmount(
  input: string,
  available: bigint
): { raw: bigint | null; error: string | null } {
  if (input.trim() === '') return { raw: null, error: null }
  const whole = parseAmount(input, 0)
  if (whole === null) return { raw: null, error: 'Enter a whole number of QSR' }
  if (whole < BigInt(MIN_FUSE_AMOUNT_QSR)) {
    return { raw: null, error: `Minimum is ${MIN_FUSE_AMOUNT_QSR} QSR` }
  }
  const raw = whole * 10n ** 8n
  if (raw > available) return { raw: null, error: 'Insufficient QSR balance' }
  return { raw, error: null }
}

/** User-facing text for a failed plazma.bot request. */
export function plasmaBotErrorText(err: unknown): string {
  if (err instanceof PlasmaBotError) {
    switch (err.code) {
      case 'ADDRESS_UNAVAILABLE':
        return 'You already have an active plazma.bot fusion for this account.'
      case 'RATE_LIMITED':
        return 'plazma.bot rate limit reached. Please try again later.'
      case 'INSUFFICIENT_BALANCE':
        return 'plazma.bot is low on QSR right now. Try again later.'
      case 'VALIDATION_FAILED':
        return 'Could not request plasma: invalid request.'
    }
  }
  return 'Failed to get plasma from plazma.bot. Please try again.'
}

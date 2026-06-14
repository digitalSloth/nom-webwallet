/** Base URL of the plasma.bot agent API (note: domain is spelled "plazma"). */
const PLASMA_BOT_API_URL = 'https://plazma.bot'

export type PlasmaBotTierKey = 'low' | 'medium' | 'high'

export interface PlasmaBotTier {
  key: PlasmaBotTierKey
  label: string
  /** QSR the bot fuses for this tier. */
  qsr: number
}

/** Tiers offered by plasma.bot, matching its agent API. */
export const PLASMA_BOT_TIERS: readonly PlasmaBotTier[] = [
  { key: 'low', label: 'Low', qsr: 20 },
  { key: 'medium', label: 'Medium', qsr: 80 },
  { key: 'high', label: 'High', qsr: 120 }
] as const

export interface PlasmaBotFuseSuccess {
  txHash: string
  address: string
  tier: PlasmaBotTierKey
  amount: number
}

export interface PlasmaBotStats {
  qsrAvailable: number
  availableTiers: PlasmaBotTierKey[]
  activeFusionCount: number
}

const KNOWN_CODES = [
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ADDRESS_UNAVAILABLE',
  'INSUFFICIENT_BALANCE',
  'FUSE_FAILED',
  'UNSUPPORTED_MEDIA_TYPE',
  'NETWORK_ERROR'
] as const

export type PlasmaBotErrorCode = (typeof KNOWN_CODES)[number]

export class PlasmaBotError extends Error {
  constructor(
    public code: PlasmaBotErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PlasmaBotError'
  }
}

/**
 * REST client for the plasma.bot agent API. Talks plain HTTP to the bot (not the
 * chain), so it is a normal class, not a ZenonService-style singleton.
 */
export class PlasmaBotService {
  constructor(private baseUrl: string = PLASMA_BOT_API_URL) {}

  /** Request a free plasma fusion from the bot to `address`. */
  async fuse(address: string, tier: PlasmaBotTierKey): Promise<PlasmaBotFuseSuccess> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/agent/fuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, tier })
      })
    } catch (err) {
      throw new PlasmaBotError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Network request failed'
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new PlasmaBotError('NETWORK_ERROR', 'Invalid response from plasma.bot')
    }

    const data = body as {
      success?: boolean
      txHash?: string
      amount?: number
      error?: { code?: string; message?: string }
    }

    if (response.ok && data.success === true) {
      return {
        txHash: data.txHash ?? '',
        address,
        tier,
        amount: data.amount ?? 0
      }
    }

    const rawCode = data.error?.code
    const code: PlasmaBotErrorCode = KNOWN_CODES.includes(rawCode as PlasmaBotErrorCode)
      ? (rawCode as PlasmaBotErrorCode)
      : 'FUSE_FAILED'
    throw new PlasmaBotError(code, data.error?.message ?? 'plasma.bot request failed')
  }

  /** Fetch public bot stats (balance + which tiers can currently be funded). */
  async getStats(): Promise<PlasmaBotStats> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/stats`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (err) {
      throw new PlasmaBotError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Network request failed'
      )
    }

    if (!response.ok) {
      throw new PlasmaBotError('NETWORK_ERROR', `plazma.bot stats returned ${response.status}`)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new PlasmaBotError('NETWORK_ERROR', 'Invalid response from plazma.bot')
    }

    const data = body as {
      qsrAvailable?: number
      availableTiers?: unknown
      activeFusionCount?: number
    }

    const validKeys = PLASMA_BOT_TIERS.map((t) => t.key)
    const availableTiers = Array.isArray(data.availableTiers)
      ? data.availableTiers.filter((t): t is PlasmaBotTierKey =>
          validKeys.includes(t as PlasmaBotTierKey)
        )
      : []

    return {
      qsrAvailable: typeof data.qsrAvailable === 'number' ? data.qsrAvailable : 0,
      availableTiers,
      activeFusionCount: typeof data.activeFusionCount === 'number' ? data.activeFusionCount : 0
    }
  }
}

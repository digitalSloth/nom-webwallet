import { PLASMA_BOT_API_URL } from '@/config'

export type PlasmaBotTierKey = 'low' | 'medium' | 'high'

export interface PlasmaBotFuseSuccess {
  txHash: string
  address: string
  tier: PlasmaBotTierKey
  amount: number
}

export type PlasmaBotErrorCode =
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'ADDRESS_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'FUSE_FAILED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'NETWORK_ERROR'

const KNOWN_CODES: readonly PlasmaBotErrorCode[] = [
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ADDRESS_UNAVAILABLE',
  'INSUFFICIENT_BALANCE',
  'FUSE_FAILED',
  'UNSUPPORTED_MEDIA_TYPE',
  'NETWORK_ERROR'
]

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
}

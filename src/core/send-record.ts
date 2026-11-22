import { SEND_STALE_MS } from '@/config'
import type { SendContext } from './send-recorder'

// Declared here, not imported from an app: core never imports from apps.
export type SendSurface = 'popup' | 'tab' | 'window' | 'approval' | 'web' | 'sidepanel'

export interface SendRecord {
  id: string
  surface: SendSurface
  stage: 'pow-started' | 'publishing' | 'published'
  hash?: string
  /** The sending document, resolved just after the send starts. */
  documentId?: string
  context: SendContext
  startedAt: number
  publishedAt?: number
  /** Set when the sending tab gave up waiting on an attempt that may still run. */
  detached?: boolean
  heartbeatAt: number
}

/** A record whose sender is not known to be alive. */
export interface InterruptedRecord extends SendRecord {
  /** True only when the sending document is proven gone. */
  senderGone: boolean
}

export type InterruptedAction =
  | { kind: 'track'; hash: string }
  | { kind: 'maybeSent' }
  | { kind: 'notSent' }

export type SenderState = 'alive' | 'gone' | 'unknown'

/** Where interrupted records are listed from and removed. */
export interface InterruptedSource {
  list(
    now: number,
    options: { popupStart: boolean; keep?: ReadonlySet<string> }
  ): Promise<InterruptedRecord[]>
  remove(id: string): Promise<void>
  /** Deletes the record and resolves true only when it is still stored at `stage`; one caller wins across tabs. */
  take(id: string, stage: SendRecord['stage']): Promise<boolean>
}

const STAGES: readonly string[] = ['pow-started', 'publishing', 'published']

export function isSendRecord(value: unknown): value is SendRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const context = v.context as Record<string, unknown> | null | undefined
  return (
    typeof v.id === 'string' &&
    typeof v.surface === 'string' &&
    typeof v.stage === 'string' &&
    STAGES.includes(v.stage) &&
    typeof v.startedAt === 'number' &&
    Number.isFinite(v.startedAt) &&
    typeof v.heartbeatAt === 'number' &&
    Number.isFinite(v.heartbeatAt) &&
    typeof context === 'object' &&
    context !== null &&
    typeof context.title === 'string' &&
    typeof context.from === 'string' &&
    (v.stage !== 'published' || typeof v.hash === 'string')
  )
}

/** Only a proven-gone sender that never reached publishing counts as not sent. */
export function classify(record: SendRecord & { senderGone?: boolean }): InterruptedAction {
  if (record.stage === 'published') return { kind: 'track', hash: record.hash as string }
  if (record.stage === 'pow-started' && record.senderGone === true) return { kind: 'notSent' }
  return { kind: 'maybeSent' }
}

/**
 * The interrupted records among stored values: skips malformed values and
 * ids in `ownIds`; keeps a record whose heartbeat is older than
 * SEND_STALE_MS, a `popup` record at popup start, or an id in `keep`; drops
 * a record whose sender is alive unless it is `published` or `detached`. `senderGone` is
 * true only for 'gone'. Oldest `startedAt` first.
 */
export async function pickInterrupted(
  values: Iterable<unknown>,
  now: number,
  options: { popupStart: boolean; keep?: ReadonlySet<string> },
  ownIds: ReadonlySet<string>,
  senderState: (record: SendRecord) => Promise<SenderState>
): Promise<InterruptedRecord[]> {
  const candidates: SendRecord[] = []
  for (const value of values) {
    if (!isSendRecord(value)) continue
    if (ownIds.has(value.id)) continue
    const stale = now - value.heartbeatAt > SEND_STALE_MS
    const popupStart = options.popupStart && value.surface === 'popup'
    if (stale || popupStart || options.keep?.has(value.id)) candidates.push(value)
  }
  const found: InterruptedRecord[] = []
  for (const record of candidates) {
    const state = await senderState(record)
    if (state !== 'alive' || record.stage === 'published' || record.detached)
      found.push({ ...record, senderGone: state === 'gone' })
  }
  return found.sort((a, b) => a.startedAt - b.startedAt)
}

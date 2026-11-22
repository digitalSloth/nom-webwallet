import { STORAGE_KEY_WC_SESSION_META } from '@/config'
import type { PeerVerification } from './dapp-approvals'
import { createSerialQueue } from './serial-queue'
import { storageService } from './storage/storage-service'

/**
 * Verify status and approval time of each WalletConnect session, keyed by
 * topic. The SDK's session struct holds neither, so the approval flow
 * records them here and the session list reads them back.
 */

export interface SessionMeta {
  verification: PeerVerification
  approvedAt: number
}

const exclusive = createSerialQueue()

function isMeta(value: unknown): value is SessionMeta {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    (item.verification === 'valid' ||
      item.verification === 'invalid' ||
      item.verification === 'unknown') &&
    typeof item.approvedAt === 'number' &&
    Number.isFinite(item.approvedAt) &&
    item.approvedAt > 0
  )
}

/** Well-formed entries only; a malformed entry or value reads as absent. */
export async function readSessionMeta(): Promise<Record<string, SessionMeta>> {
  const stored = await storageService.get<unknown>(STORAGE_KEY_WC_SESSION_META)
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const result: Record<string, SessionMeta> = {}
  for (const [topic, value] of Object.entries(stored)) {
    if (isMeta(value)) {
      result[topic] = { verification: value.verification, approvedAt: value.approvedAt }
    }
  }
  return result
}

export function recordSessionMeta(topic: string, meta: SessionMeta): Promise<void> {
  return exclusive(async () => {
    const current = await readSessionMeta()
    await storageService.set(STORAGE_KEY_WC_SESSION_META, { ...current, [topic]: meta })
  })
}

/** Removes every entry whose topic is not in `liveTopics`. Writes nothing when nothing is removed. */
export function pruneSessionMeta(liveTopics: readonly string[]): Promise<void> {
  return exclusive(async () => {
    const current = await readSessionMeta()
    const live = new Set(liveTopics)
    const kept = Object.entries(current).filter(([topic]) => live.has(topic))
    if (kept.length === Object.keys(current).length) return
    await storageService.set(STORAGE_KEY_WC_SESSION_META, Object.fromEntries(kept))
  })
}

import { SEND_HEARTBEAT_MS, WEB_TAB_LOCK_PREFIX } from '@/config'
import { isSendRecord, pickInterrupted } from './send-record'
import type { InterruptedSource, SendRecord, SenderState } from './send-record'
import type { SendRecorder } from './send-recorder'
import { openSendRecordStore } from './storage/send-record-store'
import type { SendRecordStore } from './storage/send-record-store'

/**
 * Records each in-flight web send in IndexedDB with a heartbeat. Each tab
 * holds a Web Lock for as long as it is open, so another tab can tell a
 * closed sender from a throttled one. A record is removed once the send is
 * tracked or abandoned.
 */

// Set when the lock is requested, so a missing crypto.randomUUID only disables the lock.
let tabId = ''
let lockHeld = false

// Records this tab is still writing
const ownRecordIds = new Set<string>()
// Send hash -> stops the heartbeat of the record that carries it
const heartbeats = new Map<string, () => void>()

let activeStore: SendRecordStore | null = null

function store(): SendRecordStore {
  activeStore ??= openSendRecordStore()
  return activeStore
}

/** Requests this tab's lock. Resolves once it is granted, or at once when Web Locks are missing or the request fails. Never rejects. */
export function startTabLock(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.locks) {
      resolve()
      return
    }
    try {
      tabId ||= crypto.randomUUID()
      navigator.locks
        .request(WEB_TAB_LOCK_PREFIX + tabId, () => {
          lockHeld = true
          resolve()
          // Never settles: the browser drops the lock when the tab closes.
          return new Promise<never>(() => {})
        })
        .catch((err) => {
          console.warn('Could not take the tab lock', err)
          resolve()
        })
    } catch (err) {
      console.warn('Could not take the tab lock', err)
      resolve()
    }
  })
}

/** Marks this tab as holding no lock, as when the browser caches the page. */
export function suspendTabLock(): void {
  lockHeld = false
}

/** After a cache restore: trusts the lock only if it is still held, else requests it again. */
export async function resumeTabLock(): Promise<void> {
  if (!tabId || typeof navigator === 'undefined' || !navigator.locks) return
  try {
    const { held } = await navigator.locks.query()
    if (held?.some((lock) => lock.name === WEB_TAB_LOCK_PREFIX + tabId)) {
      lockHeld = true
      return
    }
  } catch {
    return
  }
  await startTabLock()
}

/** Deletes the records of sends made from `addresses`; does nothing before the web recorder exists. */
export async function removeSendRecordsFrom(addresses: ReadonlySet<string>): Promise<void> {
  if (!activeStore) return
  try {
    await activeStore.removeFrom(addresses)
  } catch (err) {
    console.warn('Send record storage call failed', err)
  }
}

async function senderState(record: SendRecord): Promise<SenderState> {
  if (!record.documentId) return 'unknown'
  if (typeof navigator === 'undefined' || !navigator.locks) return 'unknown'
  try {
    const { held } = await navigator.locks.query()
    const name = WEB_TAB_LOCK_PREFIX + record.documentId
    return held?.some((lock) => lock.name === name) ? 'alive' : 'gone'
  } catch {
    return 'unknown'
  }
}

// Writes are not awaited by the caller: a failure is logged and dropped.
function fire(call: () => Promise<unknown>): void {
  try {
    call().catch((err) => console.warn('Send record storage call failed', err))
  } catch (err) {
    console.warn('Send record storage call failed', err)
  }
}

export function createLocalSendRecorder(recordStore?: SendRecordStore): SendRecorder {
  const records = recordStore ?? openSendRecordStore()
  activeStore = records

  return {
    begin(context) {
      const id = crypto.randomUUID()
      const now = Date.now()
      const record: SendRecord = {
        id,
        surface: 'web',
        stage: 'pow-started',
        // A sender id without a held lock could never be proven gone.
        ...(lockHeld ? { documentId: tabId } : {}),
        context,
        startedAt: now,
        heartbeatAt: now,
      }
      let abandoned = false

      const write = (): void => {
        fire(() => records.put(record, { durable: false }))
      }
      write()
      ownRecordIds.add(id)

      const timer = setInterval(() => {
        record.heartbeatAt = Date.now()
        write()
      }, SEND_HEARTBEAT_MS)
      const stop = (): void => clearInterval(timer)

      return {
        publishing(hash) {
          if (abandoned) return Promise.resolve()
          record.stage = 'publishing'
          record.hash = hash
          heartbeats.set(hash, stop)
          return records.put(record, { durable: true }).catch((err) => {
            console.warn('Send record could not be saved before publishing', err)
            throw new Error(
              'The wallet could not save this send before publishing, so it was not published.'
            )
          })
        },
        published(hash) {
          const at = Date.now()
          record.stage = 'published'
          record.hash = hash
          record.publishedAt = at
          record.heartbeatAt = at
          write()
          if (!abandoned) heartbeats.set(hash, stop)
        },
        abandon() {
          abandoned = true
          stop()
          ownRecordIds.delete(id)
          fire(() => records.remove(id))
        },
        detach() {
          stop()
          ownRecordIds.delete(id)
          record.detached = true
          write()
        },
      }
    },

    async release(hash) {
      const stop = heartbeats.get(hash)
      if (stop) {
        stop()
        heartbeats.delete(hash)
      }
      try {
        const keys: string[] = []
        for (const value of await records.list()) {
          if (!isSendRecord(value) || value.hash !== hash) continue
          keys.push(value.id)
          ownRecordIds.delete(value.id)
        }
        for (const id of keys) await records.remove(id)
      } catch (err) {
        console.warn('Send record storage call failed', err)
      }
    },

    async stored() {
      return (await records.list()).filter(isSendRecord).map((record) => record.context)
    },
  }
}

export const localInterruptedSource: InterruptedSource = {
  async list(now, options) {
    return pickInterrupted(await store().list(), now, options, ownRecordIds, senderState)
  },
  remove: (id) => store().remove(id),
  take: (id, stage) => store().take(id, stage),
}

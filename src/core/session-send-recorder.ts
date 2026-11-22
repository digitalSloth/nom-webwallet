import { SEND_HEARTBEAT_MS, SESSION_KEY_PREFIX_SEND } from '@/config'
import { ownPanelToken, panelDocumentIdFor } from './panel-token'
import { isSendRecord, pickInterrupted } from './send-record'
import type {
  InterruptedRecord,
  InterruptedSource,
  SendRecord,
  SenderState,
  SendSurface,
} from './send-record'
import type { SendRecorder } from './send-recorder'

export { classify, isSendRecord } from './send-record'
export type { SendSurface, SendRecord, InterruptedRecord, InterruptedAction } from './send-record'

/**
 * Records each in-flight send in chrome.storage.session with a heartbeat, so
 * any extension document can find a send whose document closed mid-way. A
 * record is removed once the send is tracked or abandoned.
 */

// Records this document is still writing
const ownRecordIds = new Set<string>()
// Send hash -> stops the heartbeat of the record that carries it
const heartbeats = new Map<string, () => void>()

let ownDocumentIdPromise: Promise<string | undefined> | null = null

// The id of this document's top frame. Undefined when it cannot be resolved.
function ownDocumentId(surface: SendSurface): Promise<string | undefined> {
  ownDocumentIdPromise ??= (async () => {
    try {
      let filter: chrome.runtime.ContextFilter
      const tab = await chrome.tabs.getCurrent()
      if (tab?.id !== undefined) {
        // sidepanel.html opened in a tab is a tab, not the side panel.
        filter = { tabIds: [tab.id], contextTypes: ['TAB' as chrome.runtime.ContextType] }
      } else if (surface === 'sidepanel') {
        // The context has no window or tab, so the document's own token names it.
        const token = ownPanelToken()
        return token === undefined ? undefined : await panelDocumentIdFor(token)
      } else {
        filter = { contextTypes: ['POPUP' as chrome.runtime.ContextType] }
      }
      const contexts = await chrome.runtime.getContexts(filter)
      const tops = contexts.filter((c) => c.frameId === 0)
      // More than one candidate cannot be told apart, so no id is recorded.
      return tops.length === 1 ? tops[0].documentId : undefined
    } catch (err) {
      console.warn('Could not resolve the sending document', err)
      return undefined
    }
  })()
  return ownDocumentIdPromise
}

async function senderState(record: SendRecord): Promise<SenderState> {
  if (!record.documentId) return 'unknown'
  try {
    const contexts = await chrome.runtime.getContexts({ documentIds: [record.documentId] })
    return contexts.length > 0 ? 'alive' : 'gone'
  } catch {
    return 'unknown'
  }
}

function keyOf(id: string): string {
  return SESSION_KEY_PREFIX_SEND + id
}

// Writes are not awaited by the caller: a failure is logged and dropped.
function fire(call: () => Promise<unknown>): void {
  try {
    call().catch((err) => console.warn('Send record storage call failed', err))
  } catch (err) {
    console.warn('Send record storage call failed', err)
  }
}

export function createSessionSendRecorder(surface: SendSurface): SendRecorder {
  return {
    begin(context) {
      const id = crypto.randomUUID()
      const now = Date.now()
      const record: SendRecord = {
        id,
        surface,
        stage: 'pow-started',
        context,
        startedAt: now,
        heartbeatAt: now,
      }
      let abandoned = false

      const write = (): void => {
        fire(() => chrome.storage.session.set({ [keyOf(id)]: record }))
      }
      write()
      ownRecordIds.add(id)
      void ownDocumentId(surface).then((documentId) => {
        if (!documentId) return
        record.documentId = documentId
        if (ownRecordIds.has(id)) write()
      })

      const timer = setInterval(() => {
        record.heartbeatAt = Date.now()
        write()
      }, SEND_HEARTBEAT_MS)
      const stop = (): void => clearInterval(timer)

      return {
        publishing(hash) {
          if (abandoned) return
          record.stage = 'publishing'
          record.hash = hash
          write()
          heartbeats.set(hash, stop)
        },
        published(hash) {
          const now = Date.now()
          record.stage = 'published'
          record.hash = hash
          record.publishedAt = now
          record.heartbeatAt = now
          write()
          if (!abandoned) heartbeats.set(hash, stop)
        },
        abandon() {
          abandoned = true
          stop()
          ownRecordIds.delete(id)
          fire(() => chrome.storage.session.remove(keyOf(id)))
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
        const all = await chrome.storage.session.get(null)
        const keys: string[] = []
        for (const [key, value] of Object.entries(all)) {
          if (!key.startsWith(SESSION_KEY_PREFIX_SEND) || !isSendRecord(value)) continue
          if (value.hash !== hash) continue
          keys.push(key)
          ownRecordIds.delete(value.id)
        }
        if (keys.length > 0) await chrome.storage.session.remove(keys)
      } catch (err) {
        console.warn('Send record storage call failed', err)
      }
    },
  }
}

/**
 * Records whose writer may be gone. See pickInterrupted. Reads every
 * session-storage send record.
 */
export async function listInterrupted(
  now: number,
  options: { popupStart: boolean; keep?: ReadonlySet<string> }
): Promise<InterruptedRecord[]> {
  const all = await chrome.storage.session.get(null)
  const values = Object.entries(all)
    .filter(([key]) => key.startsWith(SESSION_KEY_PREFIX_SEND))
    .map(([, value]) => value)
  return pickInterrupted(values, now, options, ownRecordIds, senderState)
}

export async function removeSendRecord(id: string): Promise<void> {
  await chrome.storage.session.remove(keyOf(id))
}

export const sessionInterruptedSource: InterruptedSource = {
  list: listInterrupted,
  remove: removeSendRecord,
  // The extension's retry path does not race across documents.
  take: async (id) => {
    await removeSendRecord(id)
    return true
  },
}

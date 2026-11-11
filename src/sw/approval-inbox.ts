import {
  DELIVERED_OUTCOME_TTL_MS,
  MAX_PENDING_DAPP_REQUESTS,
  SESSION_KEY_APPROVAL_WINDOW_ID,
  SESSION_KEY_OUTCOMES,
  SESSION_KEY_PENDING_REQUESTS,
} from '@/config'
import type { InboxEntry, ProviderError } from '@/core/inpage-protocol'
import { openOrFocusWindow } from '@/core/extension-window'
import { createSerialQueue } from '@/core/serial-queue'
import { getPort } from './ports'

/**
 * The chrome.storage.session inbox, its cap, the approval-window lifecycle,
 * the outcome store, and single-port delivery (§6.4, §6.5, §6.6). Session
 * storage — never key material, only requests and outcomes — because a
 * manifest v3 service worker can be unloaded at any time.
 *
 * Every write runs through one serial queue (`exclusive`). Reads stay outside
 * it: settle() records an outcome before it removes the inbox entry, so a
 * reader that checks the inbox first and the outcomes second always finds an
 * id in at least one of them.
 */

interface StoredOutcome {
  id: string
  tabId: number
  frameId: number
  result?: unknown
  error?: ProviderError
  deliveredAt?: number
}

async function readInbox(): Promise<InboxEntry[]> {
  const stored = await chrome.storage.session.get(SESSION_KEY_PENDING_REQUESTS)
  const value = stored[SESSION_KEY_PENDING_REQUESTS] as InboxEntry[] | undefined
  return Array.isArray(value) ? value : []
}

async function writeInbox(entries: InboxEntry[]): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY_PENDING_REQUESTS]: entries })
}

async function readOutcomes(): Promise<StoredOutcome[]> {
  const stored = await chrome.storage.session.get(SESSION_KEY_OUTCOMES)
  const value = stored[SESSION_KEY_OUTCOMES] as StoredOutcome[] | undefined
  return Array.isArray(value) ? value : []
}

async function writeOutcomes(entries: StoredOutcome[]): Promise<void> {
  await chrome.storage.session.set({ [SESSION_KEY_OUTCOMES]: entries })
}

export async function findInboxEntry(id: string): Promise<InboxEntry | undefined> {
  return (await readInbox()).find((e) => e.id === id)
}

async function findOutcome(id: string): Promise<StoredOutcome | undefined> {
  return (await readOutcomes()).find((o) => o.id === id)
}

const exclusive = createSerialQueue()
// Separate from `exclusive`: opening a window calls stampWindow(), which
// queues on `exclusive` itself.
const windowExclusive = createSerialQueue()

/** An id is `unknown` only if it is in neither the inbox nor the outcome store (§6.4). */
export async function isTracked(id: string): Promise<boolean> {
  return (await findInboxEntry(id)) !== undefined || (await findOutcome(id)) !== undefined
}

/** Every tracked id, read once, for a resync over many ids. Inbox first (see above). */
export async function trackedIds(): Promise<Set<string>> {
  const inbox = await readInbox()
  const outcomes = await readOutcomes()
  return new Set([...inbox.map((e) => e.id), ...outcomes.map((o) => o.id)])
}

export async function listInbox(): Promise<InboxEntry[]> {
  return readInbox()
}

export type AddToInboxResult = 'added' | 'tracked' | 'full'

/**
 * Appends a new inbox entry. The id is checked against the inbox and the
 * outcome store inside the same queued step as the write, so a re-sent
 * request racing its original can never be added twice (§6.4).
 */
export function addToInbox(entry: InboxEntry): Promise<AddToInboxResult> {
  return exclusive(async () => {
    const inbox = await readInbox()
    if (inbox.some((e) => e.id === entry.id) || (await findOutcome(entry.id))) return 'tracked'
    if (inbox.length >= MAX_PENDING_DAPP_REQUESTS) return 'full'
    await writeInbox([...inbox, entry])
    return 'added'
  })
}

/** Stamps every not-yet-stamped entry with the window now showing it (§6.6). */
export function stampWindow(windowId: number): Promise<void> {
  return exclusive(async () => {
    const inbox = await readInbox()
    let changed = false
    for (const entry of inbox) {
      if (entry.windowId === undefined) {
        entry.windowId = windowId
        changed = true
      }
    }
    if (changed) await writeInbox(inbox)
  })
}

/** chrome.windows.onRemoved rejects only that window's entries (§6.6). */
export async function rejectEntriesForWindow(windowId: number, reason: ProviderError): Promise<void> {
  const rejected = await exclusive(async () => {
    const inbox = await readInbox()
    const forWindow = inbox.filter((e) => e.windowId === windowId)
    if (forWindow.length === 0) return []

    const outcomes = forWindow.map(
      (e): StoredOutcome => ({ id: e.id, tabId: e.tabId, frameId: e.frameId, error: reason })
    )
    await storeOutcomes(outcomes)
    await writeInbox(inbox.filter((e) => e.windowId !== windowId))
    return outcomes
  })

  for (const outcome of rejected) await deliver(outcome)
}

/**
 * Settles a pending inbox entry by id: records the outcome, removes the
 * entry, then delivers. A no-op if the entry is already settled, so a
 * window-close rejection and an approval racing each other settle it once.
 * `beforeDeliver` runs only when this call did the settling, after the
 * outcome is stored and before it is delivered.
 */
export async function settle(
  id: string,
  payload: { result?: unknown; error?: ProviderError },
  beforeDeliver?: (entry: InboxEntry) => Promise<void>
): Promise<void> {
  const settled = await exclusive(async () => {
    const inbox = await readInbox()
    const entry = inbox.find((e) => e.id === id)
    if (!entry) return null

    const outcome: StoredOutcome = { id, tabId: entry.tabId, frameId: entry.frameId, ...payload }
    await storeOutcomes([outcome])
    await writeInbox(inbox.filter((e) => e.id !== id))
    return { entry, outcome }
  })
  if (!settled) return

  if (beforeDeliver) await beforeDeliver(settled.entry)
  await deliver(settled.outcome)
}

/**
 * Stores outcomes as undelivered. Undelivered outcomes are kept forever;
 * only delivered ones are pruned, after DELIVERED_OUTCOME_TTL_MS, purely to
 * suppress a duplicate on an overlapping resync. Callers hold the queue.
 */
async function storeOutcomes(added: StoredOutcome[]): Promise<void> {
  const ids = new Set(added.map((o) => o.id))
  const outcomes = await readOutcomes()
  await writeOutcomes(pruneDelivered([...outcomes.filter((o) => !ids.has(o.id)), ...added]))
}

function pruneDelivered(outcomes: StoredOutcome[]): StoredOutcome[] {
  const now = Date.now()
  return outcomes.filter((o) => o.deliveredAt === undefined || now - o.deliveredAt < DELIVERED_OUTCOME_TTL_MS)
}

/** Single-port delivery to the port registered for `${tabId}:${frameId}` — never fanned out (§6.4). */
async function deliver(outcome: StoredOutcome): Promise<void> {
  const port = getPort(outcome.tabId, outcome.frameId)
  if (!port) return
  try {
    port.postMessage({ kind: 'outcome', id: outcome.id, result: outcome.result, error: outcome.error })
  } catch {
    // The port died between lookup and post; the outcome stays undelivered
    // and a future resync will pick it up.
    return
  }
  await markDelivered(outcome.id)
}

function markDelivered(id: string): Promise<void> {
  return exclusive(async () => {
    const outcomes = await readOutcomes()
    const entry = outcomes.find((o) => o.id === id)
    if (!entry || entry.deliveredAt !== undefined) return
    entry.deliveredAt = Date.now()
    await writeOutcomes(outcomes)
  })
}

/** Re-attempts delivery for a set of ids addressed to this tab/frame — called on resync. */
export async function redeliverTo(tabId: number, frameId: number, ids: string[]): Promise<void> {
  const outcomes = await readOutcomes()
  for (const outcome of outcomes) {
    if (outcome.tabId === tabId && outcome.frameId === frameId && ids.includes(outcome.id)) {
      await deliver(outcome)
    }
  }
}

// --- Approval window lifecycle (§6.6) ---

/**
 * Opens the approval window, or focuses the open one, and stamps the waiting
 * entries with it. Queued, so two requests arriving together never both find
 * no stored window and open one each.
 */
export function openOrFocusApprovalWindow(): Promise<void> {
  return windowExclusive(async () => {
    const windowId = await openOrFocusWindow(
      SESSION_KEY_APPROVAL_WINDOW_ID,
      chrome.runtime.getURL('approve.html'),
      { width: 380, height: 600 }
    )
    await stampWindow(windowId)
  })
}

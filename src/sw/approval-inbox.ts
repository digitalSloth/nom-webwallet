import {
  DELIVERED_OUTCOME_TTL_MS,
  MAX_PENDING_DAPP_REQUESTS,
  SESSION_KEY_APPROVAL_WINDOW_ID,
  SESSION_KEY_OUTCOMES,
  SESSION_KEY_PENDING_REQUESTS,
} from '@/config'
import type { InboxEntry, ProviderError } from '@/core/inpage-protocol'
import { getPort } from './ports'

/**
 * The chrome.storage.session inbox, its cap, the approval-window lifecycle,
 * the outcome store, and single-port delivery (§6.4, §6.5, §6.6). Session
 * storage — never key material, only requests and outcomes — because a
 * manifest v3 service worker can be unloaded at any time.
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

/** An id is `unknown` only if it is in neither the inbox nor the outcome store (§6.4). */
export async function isTracked(id: string): Promise<boolean> {
  return (await findInboxEntry(id)) !== undefined || (await findOutcome(id)) !== undefined
}

export async function listInbox(): Promise<InboxEntry[]> {
  return readInbox()
}

/**
 * Appends a new inbox entry; returns false at cap. Callers must check
 * isTracked() first — this never dedupes by id itself, so the
 * write-before-reply and idempotent-by-id rules stay explicit at the call
 * site in router.ts (§6.4), not hidden in here.
 */
export async function addToInbox(entry: InboxEntry): Promise<boolean> {
  const inbox = await readInbox()
  if (inbox.length >= MAX_PENDING_DAPP_REQUESTS) return false
  inbox.push(entry)
  await writeInbox(inbox)
  return true
}

async function removeFromInbox(id: string): Promise<InboxEntry | undefined> {
  const inbox = await readInbox()
  const index = inbox.findIndex((e) => e.id === id)
  if (index === -1) return undefined
  const [entry] = inbox.splice(index, 1)
  await writeInbox(inbox)
  return entry
}

/** Stamps every not-yet-stamped entry with the window now showing it (§6.6). */
export async function stampWindow(windowId: number): Promise<void> {
  const inbox = await readInbox()
  let changed = false
  for (const entry of inbox) {
    if (entry.windowId === undefined) {
      entry.windowId = windowId
      changed = true
    }
  }
  if (changed) await writeInbox(inbox)
}

/** chrome.windows.onRemoved rejects only that window's entries (§6.6). */
export async function rejectEntriesForWindow(windowId: number, reason: ProviderError): Promise<void> {
  const inbox = await readInbox()
  const forWindow = inbox.filter((e) => e.windowId === windowId)
  if (forWindow.length === 0) return

  await writeInbox(inbox.filter((e) => e.windowId !== windowId))
  for (const entry of forWindow) {
    await settle(entry.id, entry.tabId, entry.frameId, { error: reason })
  }
}

/** Settles an inbox entry by id: removes it, records the outcome, delivers it. */
export async function settle(
  id: string,
  tabId: number,
  frameId: number,
  payload: { result?: unknown; error?: ProviderError }
): Promise<void> {
  await removeFromInbox(id)
  await recordOutcome(id, tabId, frameId, payload)
}

/**
 * Records an outcome as undelivered, then attempts single-port delivery to
 * the port registered for `${tabId}:${frameId}` — never fanned out (§6.4).
 * Undelivered outcomes are kept forever; only delivered ones are pruned,
 * after DELIVERED_OUTCOME_TTL_MS, purely to suppress a duplicate on an
 * overlapping resync.
 */
async function recordOutcome(
  id: string,
  tabId: number,
  frameId: number,
  payload: { result?: unknown; error?: ProviderError }
): Promise<void> {
  const outcomes = await readOutcomes()
  const stored: StoredOutcome = { id, tabId, frameId, ...payload }
  const next = pruneDelivered([...outcomes.filter((o) => o.id !== id), stored])
  await writeOutcomes(next)
  await deliver(stored)
}

function pruneDelivered(outcomes: StoredOutcome[]): StoredOutcome[] {
  const now = Date.now()
  return outcomes.filter((o) => o.deliveredAt === undefined || now - o.deliveredAt < DELIVERED_OUTCOME_TTL_MS)
}

async function deliver(outcome: StoredOutcome): Promise<void> {
  const port = getPort(outcome.tabId, outcome.frameId)
  if (!port) return
  try {
    port.postMessage({ kind: 'outcome', id: outcome.id, result: outcome.result, error: outcome.error })
    await markDelivered(outcome.id)
  } catch {
    // The port died between lookup and post; the outcome stays undelivered
    // and a future resync will pick it up.
  }
}

async function markDelivered(id: string): Promise<void> {
  const outcomes = await readOutcomes()
  const entry = outcomes.find((o) => o.id === id)
  if (!entry || entry.deliveredAt !== undefined) return
  entry.deliveredAt = Date.now()
  await writeOutcomes(outcomes)
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
 * chrome.windows.create({url: approve.html, type: 'popup'}), reusing a
 * stored window id via chrome.windows.update when one is open.
 *
 * Known limitation: on macOS, Chrome cannot reliably attach a new popup
 * window while the browser is in native fullscreen — a platform limitation
 * (MetaMask has the same issue), not something fixable from here. See the
 * README's "Known limitation" note under WalletConnect.
 */
export async function openOrFocusApprovalWindow(): Promise<void> {
  const stored = await chrome.storage.session.get(SESSION_KEY_APPROVAL_WINDOW_ID)
  const existingId = stored[SESSION_KEY_APPROVAL_WINDOW_ID] as number | undefined

  if (existingId !== undefined) {
    try {
      await chrome.windows.update(existingId, { focused: true })
      await stampWindow(existingId)
      return
    } catch {
      // The stored window no longer exists; fall through and create one.
    }
  }

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL('approve.html'),
    type: 'popup',
    width: 380,
    height: 600,
  })
  if (created.id === undefined) return

  await chrome.storage.session.set({ [SESSION_KEY_APPROVAL_WINDOW_ID]: created.id })
  await stampWindow(created.id)
}

export async function clearApprovalWindow(windowId: number): Promise<void> {
  const stored = await chrome.storage.session.get(SESSION_KEY_APPROVAL_WINDOW_ID)
  if (stored[SESSION_KEY_APPROVAL_WINDOW_ID] === windowId) {
    await chrome.storage.session.remove(SESSION_KEY_APPROVAL_WINDOW_ID)
  }
}

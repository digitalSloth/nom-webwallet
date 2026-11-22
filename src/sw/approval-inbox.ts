import {
  DELIVERED_OUTCOME_TTL_MS,
  MAX_PENDING_DAPP_REQUESTS,
  MAX_PENDING_PER_ORIGIN,
  MAX_PENDING_PER_TAB,
  SESSION_KEY_APPROVAL_WINDOW_ID,
  SESSION_KEY_OUTCOMES,
  SESSION_KEY_PENDING_REQUESTS,
  STORAGE_KEY_WALLETS,
} from '@/config'
import {
  ERR_USER_REJECTED,
  ZNN_CONNECT,
  type InboxEntry,
  type ProviderError,
} from '@/core/inpage-protocol'
import { openOrFocusWindow } from '@/core/extension-window'
import { createSerialQueue } from '@/core/serial-queue'
import { getPort } from './ports'

/**
 * The chrome.storage.session inbox, its cap, the approval-window lifecycle,
 * the outcome store, and single-port delivery (§6.4, §6.5, §6.6). Session
 * storage holds requests, outcomes and window ids, because a manifest v3
 * service worker can be unloaded at any time. The only key material in
 * session storage is the key cache in core/key-cache.ts: trusted contexts
 * only, wiped on lock, lock all, auto-lock, wallet removal and the last
 * browser window closing.
 *
 * Every write runs through one serial queue (`exclusive`). Reads stay outside
 * it: settle() records an outcome before it removes the inbox entry, so a
 * reader that checks the inbox first and the outcomes second always finds an
 * id in at least one of them.
 */

/** The outcome of a request whose approval window or side panel closed without a decision. */
export const APPROVAL_CLOSED_ERROR: ProviderError = {
  code: ERR_USER_REJECTED,
  message: 'The approval window was closed.',
}

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
    if (inbox.filter((e) => e.origin === entry.origin).length >= MAX_PENDING_PER_ORIGIN)
      return 'full'
    if (inbox.filter((e) => e.tabId === entry.tabId).length >= MAX_PENDING_PER_TAB) return 'full'
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
      if (entry.windowId === undefined && entry.panelWindowId === undefined) {
        entry.windowId = windowId
        changed = true
      }
    }
    if (changed) await writeInbox(inbox)
  })
}

async function rejectWhere(
  match: (e: InboxEntry) => boolean,
  reason: ProviderError
): Promise<void> {
  const rejected = await exclusive(async () => {
    const inbox = await readInbox()
    const matched = inbox.filter(match)
    if (matched.length === 0) return []

    const outcomes = matched.map(
      (e): StoredOutcome => ({ id: e.id, tabId: e.tabId, frameId: e.frameId, error: reason })
    )
    await storeOutcomes(outcomes)
    await writeInbox(inbox.filter((e) => !match(e)))
    return outcomes
  })

  for (const outcome of rejected) await deliver(outcome)
}

/** chrome.windows.onRemoved rejects only that window's entries, and those shown in its side panel (§6.6). */
export function rejectEntriesForWindow(windowId: number, reason: ProviderError): Promise<void> {
  return rejectWhere((e) => e.windowId === windowId || e.panelWindowId === windowId, reason)
}

/** Rejects the entries shown in the side panel of `windowId`. */
export function rejectEntriesForPanel(windowId: number, reason: ProviderError): Promise<void> {
  return rejectWhere((e) => e.panelWindowId === windowId, reason)
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
  return outcomes.filter(
    (o) => o.deliveredAt === undefined || now - o.deliveredAt < DELIVERED_OUTCOME_TTL_MS
  )
}

/** Single-port delivery to the port registered for `${tabId}:${frameId}` — never fanned out (§6.4). */
async function deliver(outcome: StoredOutcome): Promise<void> {
  const port = getPort(outcome.tabId, outcome.frameId)
  if (!port) return
  try {
    port.postMessage({
      kind: 'outcome',
      id: outcome.id,
      result: outcome.result,
      error: outcome.error,
    })
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

/**
 * True when `address` is an account of a stored wallet, hidden accounts
 * included. Reads storage directly: public-state.ts registers a storage
 * listener at load, and the approval window loads this module too.
 */
async function isKnownAccount(address: string): Promise<boolean> {
  if (typeof address !== 'string' || address === '') return false
  const stored = await chrome.storage.local.get(STORAGE_KEY_WALLETS)
  const value = stored[STORAGE_KEY_WALLETS] as { wallets?: unknown } | null | undefined
  const wallets = value?.wallets
  if (!Array.isArray(wallets)) return false
  return wallets.some((w: { accounts?: unknown } | null) => {
    const accounts = w?.accounts
    return (
      Array.isArray(accounts) &&
      accounts.some((a: { address?: unknown } | null) => a?.address === address)
    )
  })
}

/** Replaces a pending znn_connect entry's account with an account of a stored wallet. */
export function rebindConnect(id: string, account: string): Promise<boolean> {
  return exclusive(async () => {
    const inbox = await readInbox()
    const entry = inbox.find((e) => e.id === id)
    if (!entry || entry.method !== ZNN_CONNECT) return false
    if (!(await isKnownAccount(account))) return false
    await writeInbox(inbox.map((e) => (e.id === id ? { ...e, account } : e)))
    return true
  })
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
      // The outer size includes the title bar; 680 leaves room around the
      // centred 360x600 frame.
      { width: 420, height: 680 }
    )
    await stampWindow(windowId)
  })
}

/**
 * The web app's session backend. Rules:
 * - Keys stay in this tab's memory. Nothing that holds a key is shared.
 * - The BroadcastChannel carries only lock messages. A received message can
 *   drop a session, never add or extend one.
 * - localStorage holds only the last activity time (ms).
 * - Every failure path locks sooner, never later.
 * - A raised auto-lock time applies only after a check passes under the old one.
 */
import {
  AUTO_LOCK_CHOICES,
  KEY_CACHE_TOUCH_INTERVAL_MS,
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_LOCKED_AT,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
  STORAGE_KEY_WALLETS,
  WEB_SESSION_CHANNEL,
} from '@/config'
import {
  autoLockMs,
  isActivityExpired,
  parseAutoLockMinutes,
  setAutoLockMinutes,
} from './auto-lock-policy'
import { sessionManager, type SessionBackend } from './session-manager'
import { storageService } from './storage/storage-service'

export type WebSessionChange = 'lock' | 'wallets'

let started: Promise<void> | null = null
let channel: BroadcastChannel | null = null
let lastTouchAt = 0
let minutesChanged = false
// The latest shared activity time this tab has evaluated.
let seenActivity = 0
// The last time this tab confirmed a session live (a check that kept it, or an unlock).
let lastConfirmedAt = 0
// The timeout in force at the last passing check.
let confirmedTimeout = Infinity
const listeners = new Set<(change: WebSessionChange) => void>()

function readActivity(): number | undefined {
  return readTime(SESSION_KEY_LAST_ACTIVITY)
}

function readTime(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

function writeActivity(now: number): void {
  try {
    localStorage.setItem(SESSION_KEY_LAST_ACTIVITY, String(now))
  } catch (error) {
    // Without a shared write, expiry counts from unlockedAt, which only locks sooner.
    console.error('Could not record session activity.', error)
  }
}

function writeLockedAt(now: number): void {
  try {
    localStorage.setItem(SESSION_KEY_LOCKED_AT, String(now))
  } catch (error) {
    console.error('Could not record the lock time.', error)
  }
}

function post(address: string | null): void {
  try {
    channel?.postMessage({ kind: 'lock', address })
  } catch (error) {
    console.error('Could not post the lock message.', error)
  }
}

function parseLockMessage(data: unknown): { address: string | null } | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as { kind?: unknown; address?: unknown }
  if (message.kind !== 'lock') return null
  if (message.address !== null && typeof message.address !== 'string') return null
  return { address: message.address }
}

function notify(change: WebSessionChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change)
    } catch (error) {
      console.error('Web session listener failed.', error)
    }
  }
}

/**
 * A session is expired when any of these holds, whatever the shared activity
 * says now:
 * - another tab locked everything after this session began;
 * - this tab did not confirm it live for longer than the timeout, so the
 *   deadline passed unchecked (a frozen, asleep or cached tab);
 * - the shared activity jumped past this tab's last seen activity by more
 *   than the timeout, which proves the deadline passed in between.
 * Fresh activity from another tab, such as a new wallet, never revives one.
 */
function isSessionExpired(unlockedAt: number): boolean {
  const now = Date.now()
  const timeout = Math.min(autoLockMs(), confirmedTimeout)

  const lockedAt = readTime(SESSION_KEY_LOCKED_AT)
  if (lockedAt !== undefined && unlockedAt < Math.min(lockedAt, now)) return true

  if (unlockedAt <= lastConfirmedAt + timeout && now - lastConfirmedAt > timeout) return true

  const stored = readActivity()
  if (stored !== undefined && stored > Math.max(seenActivity, unlockedAt) + timeout) return true

  if (isActivityExpired(Math.max(stored ?? 0, unlockedAt), now, timeout)) return true

  if (stored !== undefined) seenActivity = Math.max(seenActivity, stored)
  lastConfirmedAt = now
  confirmedTimeout = autoLockMs()
  return false
}

const backend: SessionBackend = {
  isExpired: isSessionExpired,
  unlocked() {
    // Evaluate every held session first, while lastConfirmedAt still holds the
    // last check: sessions that went unchecked past their deadline expire now,
    // and this unlock must not confirm them.
    sessionManager.getUnlockedAddresses()
    const now = Date.now()
    lastConfirmedAt = now
    confirmedTimeout = autoLockMs()
    seenActivity = now
    lastTouchAt = now
    writeActivity(now)
  },
  locked(address) {
    if (address === null) writeLockedAt(Date.now())
    post(address)
  },
}

/**
 * Attaches the web session backend and joins the lock channel. Resolves once
 * the stored auto-lock minutes apply. Never rejects. A second call returns
 * the first call's promise.
 */
export function startWebSession(): Promise<void> {
  if (started) return started

  sessionManager.attach(backend)

  if (typeof BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(WEB_SESSION_CHANNEL)
      channel.onmessage = (event) => {
        const message = parseLockMessage(event.data)
        if (!message) return
        // drop never calls the backend, so a received lock is never posted again.
        sessionManager.drop(message.address)
        notify('lock')
      }
    } catch (error) {
      channel = null
      console.error('Could not open the lock channel.', error)
    }
  }

  // A page kept in the back/forward cache keeps its memory, so it drops its keys.
  window.addEventListener('pagehide', (event) => {
    if ((event as PageTransitionEvent).persisted) sessionManager.drop(null)
  })

  storageService.onChange((key, value) => {
    if (key === STORAGE_KEY_AUTO_LOCK_MINUTES) {
      minutesChanged = true
      setAutoLockMinutes(parseAutoLockMinutes(value))
    } else if (key === STORAGE_KEY_WALLETS) {
      notify('wallets')
    }
  })

  started = storageService.get(STORAGE_KEY_AUTO_LOCK_MINUTES).then(
    (stored) => {
      if (!minutesChanged) setAutoLockMinutes(parseAutoLockMinutes(stored))
    },
    (error) => {
      console.error('Could not read the auto-lock setting.', error)
      // The shortest choice: an unreadable setting locks sooner.
      if (!minutesChanged) setAutoLockMinutes(AUTO_LOCK_CHOICES[0])
    }
  )
  return started
}

/** Records user activity in this tab. Never extends a session that already expired. */
export function noteActivity(): void {
  if (!started) return
  // Expiry runs first: an expired session locks (and posts) here, before
  // this activity could extend it.
  if (sessionManager.getUnlockedAddresses().length === 0) return
  const now = Date.now()
  if (now - lastTouchAt < KEY_CACHE_TOUCH_INTERVAL_MS) return
  lastTouchAt = now
  seenActivity = now
  writeActivity(now)
}

/** Calls `listener` after another tab locks a wallet, or after the wallet list changes. */
export function onWebSessionChange(listener: (change: WebSessionChange) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

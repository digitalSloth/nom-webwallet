import { KeyStore } from 'znn-typescript-sdk'
import {
  AUTO_LOCK_ALARM,
  KEY_CACHE_TOUCH_INTERVAL_MS,
  SESSION_KEY_LAST_ACTIVITY,
  SESSION_KEY_PREFIX_UNLOCKED,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
} from '@/config'
import {
  autoLockMs,
  isActivityExpired,
  parseAutoLockMinutes,
  readAutoLockMinutes,
  setAutoLockMinutes,
} from './auto-lock-policy'
import { sessionManager, type SessionBackend } from './session-manager'

/**
 * Mirrors each unlocked wallet's entropy into chrome.storage.session so every
 * extension document (popup, side panel, tab, approval window, WalletConnect window)
 * shares one unlock. The area is restricted to trusted contexts, entries
 * expire after the chosen auto-lock time (default 30 minutes) without
 * activity, and the service worker wipes them on auto-lock and when the
 * last browser window closes (sw/auto-lock.ts).
 */

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>

// Last known lastActivityAt
let mirror: number | undefined
// Addresses whose key this document holds
const held = new Set<string>()
// Every address seen in a key entry
const known = new Set<string>()
const pending = new Set<Promise<unknown>>()
const listeners = new Set<() => void>()
let lastTouchAt = 0
let timer: ReturnType<typeof setTimeout> | undefined
let active = false
let failed = false
let hydrating = false
let buffer: Changes[] = []
// Set once a local change to the auto-lock setting arrived, so hydrate keeps it
let minutesChanged = false

function issue(promise: Promise<unknown>): void {
  const tracked: Promise<unknown> = promise
    .catch((error) => console.error('Key cache storage call failed.', error))
    .finally(() => pending.delete(tracked))
  pending.add(tracked)
}

function notify(): void {
  for (const listener of listeners) listener()
}

function isKeyEntry(key: string): boolean {
  return key.startsWith(SESSION_KEY_PREFIX_UNLOCKED)
}

function addressOf(key: string): string {
  return key.slice(SESSION_KEY_PREFIX_UNLOCKED.length)
}

/** Rebuilds a key store from cached entropy, or null when it does not match the address. */
function rebuild(address: string, entropy: unknown): KeyStore | null {
  try {
    if (typeof entropy !== 'string') return null
    const keyStore = KeyStore.fromEntropy(entropy)
    return keyStore.getBaseAddress().toString() === address ? keyStore : null
  } catch {
    return null
  }
}

function restoreEntry(address: string, entropy: unknown): boolean {
  const keyStore = rebuild(address, entropy)
  if (!keyStore) return false
  sessionManager.restore(address, keyStore)
  held.add(address)
  return true
}

function scheduleTimer(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
  if (mirror === undefined) return
  const delay = Math.max(0, mirror + autoLockMs() - Date.now()) + 1
  timer = setTimeout(onTimer, delay)
}

function onTimer(): void {
  // A document that holds no key must not sweep keys other documents wrote.
  if (held.size === 0) {
    notify()
    return
  }
  if (isActivityExpired(mirror, Date.now(), autoLockMs())) {
    sessionManager.lockAll()
    notify()
  } else {
    scheduleTimer()
  }
}

function applyChange(changes: Changes): void {
  // Apply the activity time first so a restored session is never seen as expired.
  const activity = changes[SESSION_KEY_LAST_ACTIVITY]?.newValue
  if (typeof activity === 'number') {
    mirror = activity
    scheduleTimer()
  }
  for (const [key, change] of Object.entries(changes)) {
    if (isKeyEntry(key)) {
      const address = addressOf(key)
      if (change.newValue !== undefined) {
        known.add(address)
        if (held.has(address)) continue
        if (restoreEntry(address, change.newValue)) notify()
        else console.error('Ignored a key cache entry that does not match its address.')
      } else {
        sessionManager.drop(address)
        held.delete(address)
        notify()
      }
    }
  }
}

function applyAutoLockMinutes(value: unknown): void {
  minutesChanged = true
  setAutoLockMinutes(parseAutoLockMinutes(value)) // a removed key (undefined) means 30
  if (!active) return // startKeyCache schedules the timer itself after hydrate
  scheduleTimer()
  if (held.size > 0 && mirror !== undefined) {
    issue(chrome.alarms.create(AUTO_LOCK_ALARM, { when: mirror + autoLockMs() + 1 }))
  }
}

function handleChange(changes: Changes, areaName: string): void {
  if (failed) return
  if (areaName === 'local') {
    if (STORAGE_KEY_AUTO_LOCK_MINUTES in changes) {
      applyAutoLockMinutes(changes[STORAGE_KEY_AUTO_LOCK_MINUTES]?.newValue)
    }
    return
  }
  if (areaName !== 'session') return
  if (hydrating) buffer.push(changes)
  else applyChange(changes)
}

const backend: SessionBackend = {
  isExpired: () => isActivityExpired(mirror, Date.now(), autoLockMs()),
  unlocked(address, keyStore) {
    const now = Date.now()
    held.add(address)
    known.add(address)
    mirror = now
    lastTouchAt = now
    issue(
      chrome.storage.session.set({
        [SESSION_KEY_PREFIX_UNLOCKED + address]: keyStore.entropy,
        [SESSION_KEY_LAST_ACTIVITY]: now,
      })
    )
    issue(chrome.alarms.create(AUTO_LOCK_ALARM, { when: now + autoLockMs() }))
    scheduleTimer()
  },
  locked(address) {
    if (address !== null) {
      held.delete(address)
      issue(chrome.storage.session.remove(SESSION_KEY_PREFIX_UNLOCKED + address))
      return
    }
    held.clear()
    issue(chrome.alarms.clear(AUTO_LOCK_ALARM))
    // The first remove runs synchronously; the sweep afterwards catches entries
    // written by other documents that this one never saw.
    issue(
      (async () => {
        await chrome.storage.session.remove([...known].map((a) => SESSION_KEY_PREFIX_UNLOCKED + a))
        const all = await chrome.storage.session.get(null)
        const left = Object.keys(all).filter(isKeyEntry)
        if (left.length > 0) await chrome.storage.session.remove(left)
      })()
    )
  },
}

async function hydrate(): Promise<void> {
  const [all, minutes] = await Promise.all([
    chrome.storage.session.get(null),
    readAutoLockMinutes(),
  ])
  if (!minutesChanged) setAutoLockMinutes(minutes)
  const keys = Object.keys(all).filter(isKeyEntry)
  const stored = all[SESSION_KEY_LAST_ACTIVITY]
  const lastActivityAt = typeof stored === 'number' ? stored : undefined

  if (isActivityExpired(lastActivityAt, Date.now(), autoLockMs())) {
    if (keys.length > 0) issue(chrome.storage.session.remove(keys))
  } else {
    for (const key of keys) {
      const address = addressOf(key)
      if (restoreEntry(address, all[key])) known.add(address)
      else issue(chrome.storage.session.remove(key))
    }
  }
  mirror = lastActivityAt
}

// Only real user input counts: a script-dispatched event never extends the auto-lock.
function onInput(event: Event): void {
  if (event.isTrusted) noteActivity()
}

/** Subscribes to the shared key cache and restores sessions unlocked elsewhere. Never rejects. */
export async function startKeyCache(): Promise<void> {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch (error) {
    console.error('Could not restrict the key cache to trusted contexts.', error)
    return
  }

  try {
    hydrating = true
    chrome.storage.onChanged.addListener(handleChange)
    await hydrate()
    hydrating = false
    const buffered = buffer
    buffer = []
    for (const changes of buffered) applyChange(changes)

    sessionManager.attach(backend)
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onInput, { capture: true, passive: true })
    }
    scheduleTimer()
    active = true
  } catch (error) {
    console.error('Key cache failed to start.', error)
    failed = true
    hydrating = false
    buffer = []
    held.clear()
    sessionManager.drop(null)
  }
}

/** Calls the listener after the cache adds or removes a session. Returns the unsubscribe. */
export function onKeyCacheChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Resolves once every storage and alarm call issued so far, and any it triggers, has settled. */
export async function whenKeyCacheIdle(): Promise<void> {
  while (pending.size > 0) await Promise.allSettled([...pending])
}

/** Records user activity: extends the shared deadline, or locks everything once it passed. */
export function noteActivity(): void {
  if (!active || held.size === 0) return
  const now = Date.now()
  if (isActivityExpired(mirror, now, autoLockMs())) {
    sessionManager.lockAll()
    notify()
    return
  }
  if (now - lastTouchAt < KEY_CACHE_TOUCH_INTERVAL_MS) return
  lastTouchAt = now
  mirror = now
  issue(chrome.storage.session.set({ [SESSION_KEY_LAST_ACTIVITY]: now }))
  issue(chrome.alarms.create(AUTO_LOCK_ALARM, { when: now + autoLockMs() }))
  scheduleTimer()
}

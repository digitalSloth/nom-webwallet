import {
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTO_LOCK_MINUTES,
  STORAGE_KEY_AUTO_LOCK_MINUTES,
} from '@/config'

export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number]

/**
 * Whether the last activity is too old to keep a wallet unlocked. A missing
 * or future timestamp counts as expired.
 */
export function isActivityExpired(
  lastActivityAt: number | undefined,
  now: number,
  autoLockMs: number
): boolean {
  if (lastActivityAt === undefined) return true
  if (now < lastActivityAt) return true
  return now - lastActivityAt > autoLockMs
}

/** Maps a stored value to a valid choice. Anything else means the default. */
export function parseAutoLockMinutes(value: unknown): AutoLockMinutes {
  const choice = AUTO_LOCK_CHOICES.find((minutes) => minutes === value)
  return choice ?? DEFAULT_AUTO_LOCK_MINUTES
}

/** Reads the stored auto-lock minutes. Never rejects: a failed read means the default. */
export async function readAutoLockMinutes(): Promise<AutoLockMinutes> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY_AUTO_LOCK_MINUTES)
    return parseAutoLockMinutes(stored[STORAGE_KEY_AUTO_LOCK_MINUTES])
  } catch (error) {
    console.error('Could not read the auto-lock setting.', error)
    return DEFAULT_AUTO_LOCK_MINUTES
  }
}

// Per document. The service worker reads the stored value on every run instead.
let current: AutoLockMinutes = DEFAULT_AUTO_LOCK_MINUTES

export function setAutoLockMinutes(minutes: AutoLockMinutes): void {
  current = minutes
}

export function autoLockMs(): number {
  return current * 60_000
}

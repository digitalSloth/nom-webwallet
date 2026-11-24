import { AUTO_LOCK_ALARM, SESSION_KEY_LAST_ACTIVITY, SESSION_KEY_PREFIX_UNLOCKED } from '@/config'
import { isActivityExpired, readAutoLockMinutes } from '@/core/auto-lock-policy'

/**
 * Service-worker side of the key cache (core/key-cache.ts): wipes the cached
 * keys when the inactivity alarm fires or the last browser window closes.
 * Imports no SDK code, so the worker bundle stays small.
 */

/**
 * Removes cached keys. `expiredKeys` are the entries seen while the session
 * was expired; only those are removed, so a key written by an unlock that
 * lands after the alarm clear survives. chrome.storage has no transactions:
 * an unlock of the same wallet between the expiry check and the remove loses
 * its key, which the unlocking document sees as a lock, so nothing leaks.
 * Without `expiredKeys`, every key entry is removed.
 */
export async function wipeKeyCache(expiredKeys?: string[]): Promise<void> {
  try {
    // Clear the alarm first: an unlock that lands during the wipe creates its
    // alarm after this clear, so a surviving key always keeps its alarm.
    await chrome.alarms.clear(AUTO_LOCK_ALARM)
    const keys = expiredKeys ?? keyEntries(await chrome.storage.session.get(null))
    if (keys.length > 0) await chrome.storage.session.remove(keys)
    await rearmForSurvivors()
  } catch (error) {
    console.error('Could not wipe the key cache.', error)
  }
}

// A surviving key may belong to an unlock whose alarm this wipe cleared, so it
// gets its alarm back at its own deadline.
async function rearmForSurvivors(): Promise<void> {
  const [all, minutes] = await Promise.all([
    chrome.storage.session.get(null),
    readAutoLockMinutes(),
  ])
  const lastActivityAt = all[SESSION_KEY_LAST_ACTIVITY]
  if (keyEntries(all).length > 0 && typeof lastActivityAt === 'number') {
    await chrome.alarms.create(AUTO_LOCK_ALARM, { when: lastActivityAt + minutes * 60_000 + 1 })
  }
}

function keyEntries(all: Record<string, unknown>): string[] {
  return Object.keys(all).filter((key) => key.startsWith(SESSION_KEY_PREFIX_UNLOCKED))
}

export async function handleAutoLockAlarm(alarm: { name: string }): Promise<void> {
  if (alarm.name !== AUTO_LOCK_ALARM) return
  try {
    // The worker loses its globals when idle, so it reads the setting each run.
    const [all, minutes] = await Promise.all([
      chrome.storage.session.get(null),
      readAutoLockMinutes(),
    ])
    const limit = minutes * 60_000
    const value = all[SESSION_KEY_LAST_ACTIVITY]
    const lastActivityAt = typeof value === 'number' ? value : undefined
    if (isActivityExpired(lastActivityAt, Date.now(), limit)) {
      await wipeKeyCache(keyEntries(all))
    } else {
      await chrome.alarms.create(AUTO_LOCK_ALARM, {
        when: (lastActivityAt as number) + limit + 1,
      })
    }
  } catch (error) {
    console.error('Auto-lock alarm failed.', error)
  }
}

export async function lockIfNoWindows(): Promise<void> {
  try {
    const windows = await chrome.windows.getAll()
    if (windows.length === 0) await wipeKeyCache()
  } catch (error) {
    console.error('Could not check the open windows.', error)
  }
}

chrome.alarms.onAlarm.addListener((alarm) => void handleAutoLockAlarm(alarm))

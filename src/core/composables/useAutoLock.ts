import { readonly, ref, type Ref } from 'vue'
import { DEFAULT_AUTO_LOCK_MINUTES, STORAGE_KEY_AUTO_LOCK_MINUTES } from '@/config'
import { parseAutoLockMinutes, type AutoLockMinutes } from '../auto-lock-policy'
import { storageService } from '../storage/storage-service'

// Module-level reactive state, shared across every useAutoLock() caller
const minutes = ref<AutoLockMinutes>(DEFAULT_AUTO_LOCK_MINUTES)
let started = false
let changed = false

function start(): void {
  started = true
  storageService.onChange((key, value) => {
    if (key !== STORAGE_KEY_AUTO_LOCK_MINUTES) return
    changed = true
    minutes.value = parseAutoLockMinutes(value)
  })
  storageService.get(STORAGE_KEY_AUTO_LOCK_MINUTES).then(
    (stored) => {
      if (!changed) minutes.value = parseAutoLockMinutes(stored)
    },
    (error) => console.error('Could not read the auto-lock setting.', error)
  )
}

/**
 * The auto-lock time chosen in Security. The value lives in the storage
 * adapter: chrome.storage.local in the extension, localStorage as a JSON
 * number on the web.
 */
export function useAutoLock(): {
  minutes: Readonly<Ref<AutoLockMinutes>>
  setMinutes(minutes: AutoLockMinutes): Promise<void>
} {
  if (!started) start()

  async function setMinutes(value: AutoLockMinutes): Promise<void> {
    await storageService.set(STORAGE_KEY_AUTO_LOCK_MINUTES, value)
    minutes.value = value
  }

  return { minutes: readonly(minutes), setMinutes }
}

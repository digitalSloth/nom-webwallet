import { readonly, ref, type Ref } from 'vue'
import { STORAGE_KEY_AUTO_RECEIVE } from '@/config'
import { storageService } from '../storage/storage-service'

// Module-level reactive state, shared across every useAutoReceiveSetting() caller
const enabled = ref(false)
let started = false
let changed = false

function start(): void {
  started = true
  storageService.onChange((key, value) => {
    if (key !== STORAGE_KEY_AUTO_RECEIVE) return
    changed = true
    enabled.value = value === true
  })
  storageService.get(STORAGE_KEY_AUTO_RECEIVE).then(
    (stored) => {
      if (!changed) enabled.value = stored === true
    },
    (error) => console.error('Could not read the auto-receive setting.', error)
  )
}

/**
 * The Auto-receive switch in Settings. The value lives in the storage
 * adapter: chrome.storage.local in the extension, localStorage on the web.
 * Only `true` counts as on.
 */
export function useAutoReceiveSetting(): {
  enabled: Readonly<Ref<boolean>>
  /** Rejects, keeping the old value, when the save fails. */
  setEnabled(on: boolean): Promise<void>
} {
  if (!started) start()

  async function setEnabled(on: boolean): Promise<void> {
    await storageService.set(STORAGE_KEY_AUTO_RECEIVE, on)
    changed = true
    enabled.value = on
  }

  return { enabled: readonly(enabled), setEnabled }
}

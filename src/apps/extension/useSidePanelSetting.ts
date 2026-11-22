import { ref, type Ref } from 'vue'
import { STORAGE_KEY_SIDE_PANEL } from '@/config'
import { surface } from './surface'

/** The "Open in side panel" switch. Reads the stored choice on each call. */
export function useSidePanelSetting(): {
  enabled: Readonly<Ref<boolean>>
  /** Saves the choice. From the popup, turning it on also opens the panel and closes the popup. Rejects when the save fails. */
  setEnabled(on: boolean): Promise<void>
} {
  const enabled = ref(false)
  let changed = false
  let windowId: number | undefined

  void chrome.storage.local
    .get(STORAGE_KEY_SIDE_PANEL)
    .then((stored) => {
      if (!changed) enabled.value = stored[STORAGE_KEY_SIDE_PANEL] === true
    })
    .catch((error) => console.error('Could not read the side panel setting.', error))

  if (surface === 'popup') {
    void chrome.windows
      .getCurrent()
      .then((win) => {
        windowId = win.id
      })
      .catch((error) => console.warn('Could not resolve the current window.', error))
  }

  async function setEnabled(on: boolean): Promise<void> {
    // sidePanel.open needs the user gesture, so it starts before any await.
    let opened: Promise<boolean> | undefined
    if (on && surface === 'popup' && windowId !== undefined) {
      opened = chrome.sidePanel.open({ windowId }).then(
        () => true,
        (error) => {
          console.warn('Could not open the side panel.', error)
          return false
        }
      )
    }
    await chrome.storage.local.set({ [STORAGE_KEY_SIDE_PANEL]: on })
    changed = true
    enabled.value = on
    if (opened && (await opened)) window.close()
  }

  return { enabled, setEnabled }
}

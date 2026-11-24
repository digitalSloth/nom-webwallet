import { STORAGE_KEY_SIDE_PANEL } from '@/config'

/**
 * Service-worker side of the "Open in side panel" setting: points the
 * toolbar icon at the popup or the side panel to match the stored choice.
 * Imports no SDK code, so the worker bundle stays small.
 */

// Calls run one after another, so overlapping triggers cannot interleave
// their two API calls. Each step reads storage itself.
let queue: Promise<void> = Promise.resolve()

async function apply(): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY_SIDE_PANEL))[STORAGE_KEY_SIDE_PANEL]
    // The order leaves the toolbar icon opening something if a call fails.
    if (stored === true) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
      await chrome.action.setPopup({ popup: '' })
    } else {
      await chrome.action.setPopup({ popup: 'popup.html' })
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
    }
  } catch (error) {
    console.error('Could not apply the side panel setting.', error)
  }
}

/** Reads STORAGE_KEY_SIDE_PANEL and applies it. Calls run one after another. Never rejects. */
export function applySidePanelSetting(): Promise<void> {
  queue = queue.then(apply)
  return queue
}

chrome.runtime.onInstalled.addListener(() => void applySidePanelSetting())
chrome.runtime.onStartup.addListener(() => void applySidePanelSetting())
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && STORAGE_KEY_SIDE_PANEL in changes) void applySidePanelSetting()
})

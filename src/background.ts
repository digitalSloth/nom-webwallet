// Background service worker for the MV3 extension.

// Registers the provider's onMessage/onConnect listeners and the public-state
// onChanged broadcaster, both at module top level within their own files, so
// every event source wakes a terminated worker.
import './sw/router'
import './sw/public-state'
import {ERR_USER_REJECTED} from '@/core/inpage-protocol'
import {SESSION_KEY_APPROVAL_WINDOW_ID, SESSION_KEY_WALLETCONNECT_WINDOW_ID} from '@/config'
import {clearStoredWindow} from '@/core/extension-window'
import {rejectEntriesForWindow} from './sw/approval-inbox'

chrome.windows.onRemoved.addListener((windowId) => {
  // The approval window closing without a decision rejects only that
  // window's entries — each one was stamped with the window that showed it
  // (§6.6).
  void rejectEntriesForWindow(windowId, {
    code: ERR_USER_REJECTED,
    message: 'The approval window was closed.',
  })
  void clearStoredWindow(SESSION_KEY_APPROVAL_WINDOW_ID, windowId)
  // The WalletConnect popup window (App.vue's openWalletConnect) is reused
  // by stored id the same way; forget it once closed so the next open
  // creates a fresh window instead of trying to focus a dead one.
  void clearStoredWindow(SESSION_KEY_WALLETCONNECT_WINDOW_ID, windowId)
})

// Restrict chrome.storage.local to trusted extension contexts — the content
// scripts (src/inpage.ts, src/content-script.ts) are untrusted contexts and
// must not reach storage directly; they only relay chrome.runtime messages.
// Feature-detected because setAccessLevel is not available on all supported
// Chrome versions.
async function restrictStorageAccess(): Promise<void> {
  const storage = chrome.storage.local as chrome.storage.LocalStorageArea & {
    setAccessLevel?: (options: {accessLevel: string}) => Promise<void>
  }
  if (typeof storage.setAccessLevel === 'function') {
    try {
      await storage.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'})
    } catch (error) {
      console.warn('Could not restrict storage access level.', error)
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void restrictStorageAccess()
})

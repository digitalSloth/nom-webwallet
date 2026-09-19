// Background service worker for the MV3 extension.

// Registers the provider's onMessage/onConnect listeners and the public-state
// onChanged broadcaster, both at module top level within their own files, so
// every event source wakes a terminated worker.
import './sw/router'
import './sw/public-state'
import {ERR_USER_REJECTED} from '@/core/inpage-protocol'
import {SESSION_KEY_WALLETCONNECT_WINDOW_ID} from '@/config'
import {clearApprovalWindow, rejectEntriesForWindow} from './sw/approval-inbox'

async function clearWalletConnectWindow(windowId: number): Promise<void> {
  const stored = await chrome.storage.session.get(SESSION_KEY_WALLETCONNECT_WINDOW_ID)
  if (stored[SESSION_KEY_WALLETCONNECT_WINDOW_ID] === windowId) {
    await chrome.storage.session.remove(SESSION_KEY_WALLETCONNECT_WINDOW_ID)
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  // The approval window closing without a decision rejects only that
  // window's entries — each one was stamped with the window that showed it
  // (§6.6).
  void rejectEntriesForWindow(windowId, {
    code: ERR_USER_REJECTED,
    message: 'The approval window was closed.',
  })
  void clearApprovalWindow(windowId)
  // The WalletConnect popup window (App.vue's openWalletConnect) is reused
  // by stored id the same way; forget it once closed so the next open
  // creates a fresh window instead of trying to focus a dead one.
  void clearWalletConnectWindow(windowId)
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

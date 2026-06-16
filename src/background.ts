// Background service worker for the MV3 extension.

// Restrict chrome.storage.local to trusted extension contexts (no content
// scripts today, but this fails closed if any are added later). Feature-detected
// because setAccessLevel is not available on all supported Chrome versions.
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

// Placeholder message handler; expanded in Phase 2 (WalletConnect routing).
chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({success: true})
  return true
})

// Background service worker for extension

// Listen for installation
chrome.runtime.onInstalled.addListener(() => {
  // Extension installed
})

// Add message handlers as needed
chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ success: true })
  return true
})

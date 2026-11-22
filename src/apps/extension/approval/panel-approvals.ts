import { watchWalletStorage } from '@/core/composables/useDappApprovals'
import { startInboxBridge } from '@/core/inpage-approval-bridge'
import { surface } from '../surface'

/**
 * Starts showing the dApp requests the worker bound to this side panel.
 * Resolves false, having started nothing, outside a real side panel,
 * including sidepanel.html opened in a tab. Never rejects.
 */
export async function startPanelApprovals(): Promise<boolean> {
  if (surface !== 'sidepanel') return false
  try {
    if (await chrome.tabs.getCurrent()) return false
    const windowId = (await chrome.windows.getCurrent()).id
    if (windowId === undefined) return false
    // Follows wallet and account changes made in other windows. The panel
    // lives as long as its document, so the stop function is not kept.
    watchWalletStorage()
    startInboxBridge({ kind: 'panel', windowId })
    return true
  } catch (err) {
    console.error('Could not start side panel approvals.', err)
    return false
  }
}

/**
 * Rejects every pending request as user-rejected, head first. Stops if a
 * rejection leaves the same head in place, so it cannot loop.
 */
export async function rejectAllPending(approvals: {
  currentId(): string | undefined
  reject(id: string): Promise<void>
}): Promise<void> {
  for (;;) {
    const id = approvals.currentId()
    if (id === undefined) return
    await approvals.reject(id)
    if (approvals.currentId() === id) return
  }
}

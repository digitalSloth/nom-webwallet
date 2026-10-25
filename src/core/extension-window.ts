/**
 * Extension popup windows that are reused by a window id kept in
 * chrome.storage.session: the dApp approval window and the WalletConnect
 * window.
 *
 * Known limitation: on macOS, Chrome cannot reliably attach a new popup
 * window while the browser is in native fullscreen — a platform limitation
 * (MetaMask has the same issue), not something fixable from here. See the
 * README's "Known limitation" note under WalletConnect.
 */

/** Focuses the window stored under `sessionKey`, or creates one and stores its id. */
export async function openOrFocusWindow(
  sessionKey: string,
  url: string,
  size: { width: number; height: number }
): Promise<number> {
  const stored = await chrome.storage.session.get(sessionKey)
  const existingId = stored[sessionKey] as number | undefined

  if (existingId !== undefined) {
    try {
      await chrome.windows.update(existingId, { focused: true })
      return existingId
    } catch {
      // The stored window no longer exists; fall through and create one.
    }
  }

  const created = await chrome.windows.create({ url, type: 'popup', ...size })
  if (created.id === undefined) throw new Error('The popup window was created without an id.')

  await chrome.storage.session.set({ [sessionKey]: created.id })
  return created.id
}

/** Forgets the stored id once that window closes, so the next open creates a fresh one. */
export async function clearStoredWindow(sessionKey: string, windowId: number): Promise<void> {
  const stored = await chrome.storage.session.get(sessionKey)
  if (stored[sessionKey] === windowId) {
    await chrome.storage.session.remove(sessionKey)
  }
}

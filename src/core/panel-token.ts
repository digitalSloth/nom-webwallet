/**
 * Identity of a side panel document. Chrome gives a side panel's port and
 * message sender only `{ id, url, origin }`, and its context reports
 * `windowId: -1`, so neither names the document. The panel tags its own URL
 * with a random token (`history.replaceState`), which `runtime.getContexts`
 * reports in `documentUrl` and which survives hash-router navigation.
 */

const PANEL_TOKEN_PARAM = 'panel'

/** Adds a random token to the current URL, keeping the hash. Run before the router is created. */
export function tagPanelDocument(): void {
  history.replaceState(
    null,
    '',
    `${location.pathname}?${PANEL_TOKEN_PARAM}=${crypto.randomUUID()}${location.hash}`
  )
}

/** The token in `url`, or undefined when it has none. */
export function panelTokenOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).searchParams.get(PANEL_TOKEN_PARAM) || undefined
  } catch {
    return undefined
  }
}

/** This document's token. */
export function ownPanelToken(): string | undefined {
  return new URLSearchParams(location.search).get(PANEL_TOKEN_PARAM) || undefined
}

/** The document id of the one SIDE_PANEL top frame tagged with `token`, or undefined when none or several match. */
export async function panelDocumentIdFor(token: string): Promise<string | undefined> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
  })
  const matches = contexts.filter(
    (context) => context.frameId === 0 && panelTokenOf(context.documentUrl) === token
  )
  return matches.length === 1 ? matches[0].documentId : undefined
}

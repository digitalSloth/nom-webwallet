import { afterEach, describe, expect, it, vi } from 'vitest'

import { ownPanelToken, panelDocumentIdFor, panelTokenOf, tagPanelDocument } from './panel-token'

afterEach(() => vi.unstubAllGlobals())

describe('panel token', () => {
  it('tags the url with a random token and keeps the hash', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('history', { replaceState })
    vi.stubGlobal('location', { pathname: '/sidepanel.html', hash: '#/send' })

    tagPanelDocument()

    const url = replaceState.mock.calls[0][2] as string
    expect(url).toMatch(/^\/sidepanel\.html\?panel=[0-9a-f-]{36}#\/send$/)
    expect(panelTokenOf(`chrome-extension://w${url}`)).toHaveLength(36)
  })

  it.each([
    ['no url', undefined, undefined],
    ['not a url', 'nope', undefined],
    ['no token', 'chrome-extension://w/sidepanel.html#/', undefined],
    ['a token', 'chrome-extension://w/sidepanel.html?panel=abc#/send', 'abc'],
  ])('reads the token from %s', (_name, url, token) => {
    expect(panelTokenOf(url)).toBe(token)
  })

  it('reads its own token from the location', () => {
    vi.stubGlobal('location', { search: '?panel=abc' })
    expect(ownPanelToken()).toBe('abc')
  })

  it('finds the one top frame carrying the token', async () => {
    const getContexts = vi.fn(async () => [
      { documentId: 'sub', frameId: 3, documentUrl: 'chrome-extension://w/sidepanel.html?panel=t' },
      {
        documentId: 'other',
        frameId: 0,
        documentUrl: 'chrome-extension://w/sidepanel.html?panel=u',
      },
      {
        documentId: 'mine',
        frameId: 0,
        documentUrl: 'chrome-extension://w/sidepanel.html?panel=t#/x',
      },
    ])
    vi.stubGlobal('chrome', { runtime: { getContexts } })

    expect(await panelDocumentIdFor('t')).toBe('mine')
    expect(getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function detect(pathname: string, search = '') {
  vi.stubGlobal('location', { pathname, search })
  vi.resetModules()
  return (await import('./surface')).surface
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

describe('surface', () => {
  it.each([
    ['/sidepanel.html', '', 'sidepanel'],
    ['/approve.html', '', 'approval'],
    ['/popup.html', '', 'popup'],
    ['/popup.html', '?surface=tab', 'tab'],
    ['/popup.html', '?surface=window', 'window'],
    ['/popup.html', '?surface=sidepanel', 'popup'],
  ])('%s%s is the %s surface', async (pathname, search, expected) => {
    expect(await detect(pathname, search)).toBe(expected)
  })
})

describe('placeLabelFor', () => {
  it.each([
    ['popup', 'popup'],
    ['tab', 'tab'],
    ['sidepanel', 'side panel'],
    ['window', 'window'],
    ['approval', 'window'],
  ] as const)('%s surface reads as %s', async (surface, expected) => {
    vi.stubGlobal('location', { pathname: '/popup.html', search: '' })
    const { placeLabelFor } = await import('./surface')
    expect(placeLabelFor(surface)).toBe(expected)
  })
})

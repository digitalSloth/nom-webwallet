import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_SIDE_PANEL } from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'

let env: ReturnType<typeof installFakeChrome>
let close: ReturnType<typeof vi.fn>

async function load(surface: string) {
  vi.resetModules()
  vi.doMock('./surface', () => ({ surface }))
  const { useSidePanelSetting } = await import('./useSidePanelSetting')
  const setting = useSidePanelSetting()
  await settleStorage()
  return setting
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
  close = vi.fn()
  vi.stubGlobal('window', { close })
})

afterEach(() => {
  vi.doUnmock('./surface')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useSidePanelSetting', () => {
  it('reads a stored true', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { enabled } = await load('popup')
    expect(enabled.value).toBe(true)
  })

  it.each([
    ['absent', undefined],
    ['the string true', 'true'],
  ])('reads %s as off', async (_n, value) => {
    if (value !== undefined) env.local.data[STORAGE_KEY_SIDE_PANEL] = value
    const { enabled } = await load('popup')
    expect(enabled.value).toBe(false)
  })

  it('opens the panel for the popup window before it saves, then saves and closes the popup', async () => {
    const { enabled, setEnabled } = await load('popup')

    const done = setEnabled(true)
    expect(env.chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 202 })
    expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBeUndefined()
    await done

    expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBe(true)
    expect(enabled.value).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('saves and keeps the popup open when the panel fails to open', async () => {
    const { setEnabled } = await load('popup')
    env.chrome.sidePanel.open.mockRejectedValue(new Error('no gesture'))

    await setEnabled(true)

    expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBe(true)
    expect(close).not.toHaveBeenCalled()
  })

  it('saves without opening when the window id is not resolved', async () => {
    env.chrome.windows.getCurrent.mockResolvedValue({})
    const { setEnabled } = await load('popup')

    await setEnabled(true)

    expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBe(true)
    expect(env.chrome.sidePanel.open).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it.each(['tab', 'sidepanel', 'window'])(
    'only saves when turned on from the %s surface',
    async (surface) => {
      const { setEnabled } = await load(surface)

      await setEnabled(true)

      expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBe(true)
      expect(env.chrome.sidePanel.open).not.toHaveBeenCalled()
      expect(close).not.toHaveBeenCalled()
    }
  )

  it('only saves when the popup turns it off', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { enabled, setEnabled } = await load('popup')

    await setEnabled(false)

    expect(env.local.data[STORAGE_KEY_SIDE_PANEL]).toBe(false)
    expect(enabled.value).toBe(false)
    expect(env.chrome.sidePanel.open).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('rejects and keeps the old value when the save fails', async () => {
    const { enabled, setEnabled } = await load('tab')
    vi.spyOn(env.local, 'set').mockRejectedValue(new Error('quota'))

    await expect(setEnabled(true)).rejects.toThrow('quota')

    expect(enabled.value).toBe(false)
  })

  it('does not close the popup when the save fails', async () => {
    const { setEnabled } = await load('popup')
    vi.spyOn(env.local, 'set').mockRejectedValue(new Error('quota'))

    await expect(setEnabled(true)).rejects.toThrow('quota')

    expect(close).not.toHaveBeenCalled()
  })

  it('keeps the choice when a stored read resolves after it', async () => {
    let release!: (value: Record<string, unknown>) => void
    vi.spyOn(env.local, 'get').mockReturnValue(new Promise((resolve) => (release = resolve)))
    vi.resetModules()
    vi.doMock('./surface', () => ({ surface: 'tab' }))
    const { useSidePanelSetting } = await import('./useSidePanelSetting')
    const { enabled, setEnabled } = useSidePanelSetting()

    await setEnabled(true)
    release({})
    await settleStorage()

    expect(enabled.value).toBe(true)
  })
})

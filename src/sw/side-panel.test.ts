import { beforeEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_SIDE_PANEL } from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'

let env: ReturnType<typeof installFakeChrome>
let sidePanel: typeof import('@/sw/side-panel')

const order = (mock: { mock: { invocationCallOrder: number[] } }) =>
  mock.mock.invocationCallOrder[0]

beforeEach(async () => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
  sidePanel = await import('@/sw/side-panel')
})

describe('side panel setting', () => {
  it('registers install, startup and storage change listeners on import', () => {
    expect(env.chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1)
    expect(env.chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1)
    expect(env.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
  })

  it('sets the panel behavior before it clears the popup when the stored value is true', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true

    await sidePanel.applySidePanelSetting()

    expect(env.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
      openPanelOnActionClick: true,
    })
    expect(env.chrome.action.setPopup).toHaveBeenCalledWith({ popup: '' })
    expect(order(env.chrome.sidePanel.setPanelBehavior)).toBeLessThan(
      order(env.chrome.action.setPopup)
    )
  })

  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string true', 'true'],
    ['one', 1],
  ])(
    'sets the popup before it clears the panel behavior when the stored value is %s',
    async (_n, value) => {
      if (value !== undefined) env.local.data[STORAGE_KEY_SIDE_PANEL] = value

      await sidePanel.applySidePanelSetting()

      expect(env.chrome.action.setPopup).toHaveBeenCalledWith({ popup: 'popup.html' })
      expect(env.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledWith({
        openPanelOnActionClick: false,
      })
      expect(order(env.chrome.action.setPopup)).toBeLessThan(
        order(env.chrome.sidePanel.setPanelBehavior)
      )
    }
  )

  it('leaves the popup alone and resolves when the panel behavior call rejects', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    env.chrome.sidePanel.setPanelBehavior.mockRejectedValue(new Error('boom'))

    await expect(sidePanel.applySidePanelSetting()).resolves.toBeUndefined()

    expect(env.chrome.action.setPopup).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  it('applies on install and on startup', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const installed = env.chrome.runtime.onInstalled.addListener.mock.calls[0][0] as () => void
    const startup = env.chrome.runtime.onStartup.addListener.mock.calls[0][0] as () => void

    installed()
    await settleStorage()
    expect(env.chrome.action.setPopup).toHaveBeenCalledTimes(1)
    expect(env.chrome.action.setPopup).toHaveBeenLastCalledWith({ popup: '' })

    startup()
    await settleStorage()
    expect(env.chrome.action.setPopup).toHaveBeenCalledTimes(2)
  })

  it('applies a local change to the key', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true

    env.emitStorageChange({ [STORAGE_KEY_SIDE_PANEL]: { newValue: true } }, 'local')
    await settleStorage()

    expect(env.chrome.action.setPopup).toHaveBeenCalledWith({ popup: '' })
  })

  it('ignores a session change and a change to another key', async () => {
    env.emitStorageChange({ [STORAGE_KEY_SIDE_PANEL]: { newValue: true } }, 'session')
    env.emitStorageChange({ other: { newValue: true } }, 'local')
    await settleStorage()

    expect(env.chrome.action.setPopup).not.toHaveBeenCalled()
    expect(env.chrome.sidePanel.setPanelBehavior).not.toHaveBeenCalled()
  })

  it('holds a second call until the first call has finished its API calls', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    let release!: () => void
    env.chrome.sidePanel.setPanelBehavior.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    const first = sidePanel.applySidePanelSetting()
    await settleStorage()
    env.local.data[STORAGE_KEY_SIDE_PANEL] = false
    const second = sidePanel.applySidePanelSetting()
    await settleStorage()

    expect(env.chrome.action.setPopup).not.toHaveBeenCalled()
    expect(env.chrome.sidePanel.setPanelBehavior).toHaveBeenCalledTimes(1)

    release()
    await Promise.all([first, second])

    expect(env.chrome.action.setPopup.mock.calls.map(([arg]) => arg.popup)).toEqual([
      '',
      'popup.html',
    ])
    expect(env.chrome.sidePanel.setPanelBehavior).toHaveBeenLastCalledWith({
      openPanelOnActionClick: false,
    })
  })
})

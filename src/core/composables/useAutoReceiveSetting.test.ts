import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_AUTO_RECEIVE } from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'
import { installFakeWeb, type FakeWeb } from '@/test/fake-web'

let env: ReturnType<typeof installFakeChrome>
let useAutoReceiveSetting: typeof import('./useAutoReceiveSetting').useAutoReceiveSetting

async function load(stored?: unknown, emitChanges = true) {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome({ emitChanges })
  if (stored !== undefined) env.local.data[STORAGE_KEY_AUTO_RECEIVE] = stored
  useAutoReceiveSetting = (await import('./useAutoReceiveSetting')).useAutoReceiveSetting
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAutoReceiveSetting', () => {
  it('reads a stored true as on', async () => {
    await load(true)
    const { enabled } = useAutoReceiveSetting()

    await settleStorage()

    expect(enabled.value).toBe(true)
  })

  it('is off when nothing is stored', async () => {
    await load()
    const { enabled } = useAutoReceiveSetting()

    await settleStorage()

    expect(enabled.value).toBe(false)
  })

  it.each([
    ['the string true', 'true'],
    ['the number 1', 1],
    ['false', false],
  ])('reads %s as off', async (_name, stored) => {
    await load(stored)
    const { enabled } = useAutoReceiveSetting()

    await settleStorage()

    expect(enabled.value).toBe(false)
  })

  it('is off while the first read is pending', async () => {
    await load(true)

    const { enabled } = useAutoReceiveSetting()

    expect(enabled.value).toBe(false)
  })

  it('stays off and logs when the first read fails', async () => {
    await load(true)
    const failure = new Error('unavailable')
    vi.spyOn(env.local, 'get').mockRejectedValueOnce(failure)
    const { enabled } = useAutoReceiveSetting()

    await settleStorage()

    expect(enabled.value).toBe(false)
    expect(console.error).toHaveBeenCalledWith('Could not read the auto-receive setting.', failure)
  })

  it('writes the key and updates enabled on setEnabled', async () => {
    await load(undefined, false)
    const { enabled, setEnabled } = useAutoReceiveSetting()

    await setEnabled(true)

    expect(env.local.data[STORAGE_KEY_AUTO_RECEIVE]).toBe(true)
    expect(enabled.value).toBe(true)
  })

  it('rejects and keeps the old value when the write fails', async () => {
    await load()
    const { enabled, setEnabled } = useAutoReceiveSetting()
    await settleStorage()
    vi.spyOn(env.local, 'set').mockRejectedValueOnce(new Error('quota'))

    await expect(setEnabled(true)).rejects.toThrow('quota')

    expect(enabled.value).toBe(false)
  })

  it('follows a change made elsewhere', async () => {
    await load()
    const { enabled } = useAutoReceiveSetting()
    await settleStorage()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_RECEIVE]: { newValue: true } }, 'local')
    expect(enabled.value).toBe(true)

    env.emitStorageChange({ [STORAGE_KEY_AUTO_RECEIVE]: { newValue: false } }, 'local')
    expect(enabled.value).toBe(false)
  })

  it('ignores the setting key in other areas', async () => {
    await load()
    const { enabled } = useAutoReceiveSetting()
    await settleStorage()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_RECEIVE]: { newValue: true } }, 'session')

    expect(enabled.value).toBe(false)
  })

  it('keeps a change that arrives while the first read is pending', async () => {
    await load(false)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const get = env.local.get.bind(env.local)
    vi.spyOn(env.local, 'get').mockImplementation(async (keys) => {
      await gate
      return get(keys)
    })
    const { enabled } = useAutoReceiveSetting()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_RECEIVE]: { newValue: true } }, 'local')
    release()
    await settleStorage()

    expect(enabled.value).toBe(true)
  })

  it('subscribes one listener however often it is called', async () => {
    await load()

    useAutoReceiveSetting()
    useAutoReceiveSetting()

    expect(env.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
  })
})

describe('useAutoReceiveSetting on the local adapter', () => {
  let web: FakeWeb

  async function loadWeb(stored?: string) {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    web = installFakeWeb()
    if (stored !== undefined) web.localStorage.setItem(STORAGE_KEY_AUTO_RECEIVE, stored)
    useAutoReceiveSetting = (await import('./useAutoReceiveSetting')).useAutoReceiveSetting
  }

  it('reads a stored true as on', async () => {
    await loadWeb('true')
    const { enabled } = useAutoReceiveSetting()

    await settleStorage()

    expect(enabled.value).toBe(true)
  })

  it('stores setEnabled(true) as the string true', async () => {
    await loadWeb()
    const { enabled, setEnabled } = useAutoReceiveSetting()

    await setEnabled(true)

    expect(web.localStorage.getItem(STORAGE_KEY_AUTO_RECEIVE)).toBe('true')
    expect(enabled.value).toBe(true)
  })

  it('turns off when another tab removes the setting', async () => {
    await loadWeb('true')
    const { enabled } = useAutoReceiveSetting()
    await settleStorage()

    web.emitStorageEvent(STORAGE_KEY_AUTO_RECEIVE, null)

    expect(enabled.value).toBe(false)
  })
})

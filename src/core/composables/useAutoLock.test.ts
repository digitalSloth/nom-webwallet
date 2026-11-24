import { afterEach, describe, expect, it, vi } from 'vitest'

import { STORAGE_KEY_AUTO_LOCK_MINUTES } from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'
import { installFakeWeb, type FakeWeb } from '@/test/fake-web'

let env: ReturnType<typeof installFakeChrome>
let useAutoLock: typeof import('./useAutoLock').useAutoLock

async function load(stored?: unknown, emitChanges = true) {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome({ emitChanges })
  if (stored !== undefined) env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES] = stored
  useAutoLock = (await import('./useAutoLock')).useAutoLock
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAutoLock', () => {
  it('reads the stored value on first use', async () => {
    await load(5)
    const { minutes } = useAutoLock()

    await settleStorage()

    expect(minutes.value).toBe(5)
  })

  it('uses 30 for an invalid stored value', async () => {
    await load(7)
    const { minutes } = useAutoLock()

    await settleStorage()

    expect(minutes.value).toBe(30)
  })

  it('writes the key and updates minutes on setMinutes', async () => {
    await load(undefined, false)
    const { minutes, setMinutes } = useAutoLock()

    await setMinutes(15)

    expect(env.local.data[STORAGE_KEY_AUTO_LOCK_MINUTES]).toBe(15)
    expect(minutes.value).toBe(15)
  })

  it('rejects and keeps minutes when the write fails', async () => {
    await load()
    const { minutes, setMinutes } = useAutoLock()
    await settleStorage()
    vi.spyOn(env.local, 'set').mockRejectedValueOnce(new Error('quota'))

    await expect(setMinutes(60)).rejects.toThrow('quota')

    expect(minutes.value).toBe(30)
  })

  it('follows a change made elsewhere', async () => {
    await load()
    const { minutes } = useAutoLock()
    await settleStorage()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_LOCK_MINUTES]: { newValue: 60 } }, 'local')

    expect(minutes.value).toBe(60)
  })

  it('ignores the setting key in other areas', async () => {
    await load()
    const { minutes } = useAutoLock()
    await settleStorage()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_LOCK_MINUTES]: { newValue: 60 } }, 'session')

    expect(minutes.value).toBe(30)
  })

  it('keeps a change that arrives while the first read is pending', async () => {
    await load(60)
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const get = env.local.get.bind(env.local)
    vi.spyOn(env.local, 'get').mockImplementation(async (keys) => {
      await gate
      return get(keys)
    })
    const { minutes } = useAutoLock()

    env.emitStorageChange({ [STORAGE_KEY_AUTO_LOCK_MINUTES]: { newValue: 5 } }, 'local')
    release()
    await settleStorage()

    expect(minutes.value).toBe(5)
  })

  it('subscribes one listener however often it is called', async () => {
    await load()

    useAutoLock()
    useAutoLock()

    expect(env.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
  })
})

describe('useAutoLock on the local adapter', () => {
  let web: FakeWeb

  async function loadWeb(stored?: string) {
    vi.resetModules()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    web = installFakeWeb()
    if (stored !== undefined) web.localStorage.setItem(STORAGE_KEY_AUTO_LOCK_MINUTES, stored)
    useAutoLock = (await import('./useAutoLock')).useAutoLock
  }

  it('reads a stored 5 as 5', async () => {
    await loadWeb('5')
    const { minutes } = useAutoLock()

    await settleStorage()

    expect(minutes.value).toBe(5)
  })

  it('stores setMinutes(15) as the string 15', async () => {
    await loadWeb()
    const { minutes, setMinutes } = useAutoLock()

    await setMinutes(15)

    expect(web.localStorage.getItem(STORAGE_KEY_AUTO_LOCK_MINUTES)).toBe('15')
    expect(minutes.value).toBe(15)
  })

  it('follows another tab writing 60', async () => {
    await loadWeb()
    const { minutes } = useAutoLock()
    await settleStorage()

    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, '60')

    expect(minutes.value).toBe(60)
  })

  it('returns to 30 when another tab removes the setting', async () => {
    await loadWeb('5')
    const { minutes } = useAutoLock()
    await settleStorage()

    web.emitStorageEvent(STORAGE_KEY_AUTO_LOCK_MINUTES, null)

    expect(minutes.value).toBe(30)
  })
})

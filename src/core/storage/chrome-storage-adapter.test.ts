import { afterEach, describe, expect, it, vi } from 'vitest'

import { installFakeChrome } from '@/test/fake-chrome'
import { ChromeStorageAdapter } from './chrome-storage-adapter'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChromeStorageAdapter.onChange', () => {
  it('calls the listener once per changed key in the local area', () => {
    const env = installFakeChrome()
    const listener = vi.fn()
    new ChromeStorageAdapter().onChange(listener)

    env.emitStorageChange({ a: { newValue: 1 }, b: { oldValue: 1, newValue: 'x' } }, 'local')

    expect(listener.mock.calls).toEqual([
      ['a', 1],
      ['b', 'x'],
    ])
  })

  it('gives null for a removed key', () => {
    const env = installFakeChrome()
    const listener = vi.fn()
    new ChromeStorageAdapter().onChange(listener)

    env.emitStorageChange({ a: { oldValue: 1 } }, 'local')

    expect(listener).toHaveBeenCalledExactlyOnceWith('a', null)
  })

  it('ignores a session area change', () => {
    const env = installFakeChrome()
    const listener = vi.fn()
    new ChromeStorageAdapter().onChange(listener)

    env.emitStorageChange({ a: { newValue: 1 } }, 'session')

    expect(listener).not.toHaveBeenCalled()
  })

  it('removes the chrome listener and stops calls on unsubscribe', () => {
    const env = installFakeChrome()
    const listener = vi.fn()
    const unsubscribe = new ChromeStorageAdapter().onChange(listener)
    const added = env.chrome.storage.onChanged.addListener.mock.calls[0][0]

    unsubscribe()
    env.emitStorageChange({ a: { newValue: 1 } }, 'local')

    expect(env.chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(added)
    expect(listener).not.toHaveBeenCalled()
  })

  it('throws when chrome.storage is missing', () => {
    vi.stubGlobal('chrome', {})

    expect(() => new ChromeStorageAdapter().onChange(vi.fn())).toThrow(
      'Chrome storage API not available'
    )
  })
})

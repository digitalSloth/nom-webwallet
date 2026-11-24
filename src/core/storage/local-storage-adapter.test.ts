import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeWeb, type FakeWeb } from '@/test/fake-web'
import { LocalStorageAdapter } from './local-storage-adapter'

let web: FakeWeb

beforeEach(() => {
  web = installFakeWeb()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('LocalStorageAdapter.onChange', () => {
  it('delivers another tab change with the parsed value', () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)

    web.emitStorageEvent('k', JSON.stringify({ a: 1 }))

    expect(listener).toHaveBeenCalledExactlyOnceWith('k', { a: 1 })
  })

  it('notifies own set with the written value and own remove with null', async () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)

    await adapter.set('k', 15)
    await adapter.remove('k')

    expect(listener.mock.calls).toEqual([
      ['k', 15],
      ['k', null],
    ])
  })

  it('ignores a clear event', () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)

    web.emitStorageEvent(null, null)

    expect(listener).not.toHaveBeenCalled()
  })

  it('ignores an event from another storage area', () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)

    window.dispatchEvent(
      Object.assign(new Event('storage'), { key: 'k', newValue: '1', storageArea: {} })
    )

    expect(listener).not.toHaveBeenCalled()
  })

  it('gives null for an unparsable or null new value', () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)

    web.emitStorageEvent('k', '{')
    web.emitStorageEvent('k', null)

    expect(listener.mock.calls).toEqual([
      ['k', null],
      ['k', null],
    ])
  })

  it('stops calling a listener after unsubscribe', async () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    const unsubscribe = adapter.onChange(listener)
    unsubscribe()

    web.emitStorageEvent('k', '1')
    await adapter.set('k', 2)

    expect(listener).not.toHaveBeenCalled()
  })

  it('adds one window listener for two subscriptions', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const adapter = new LocalStorageAdapter()
    const first = vi.fn()
    const second = vi.fn()
    adapter.onChange(first)
    adapter.onChange(second)

    web.emitStorageEvent('k', '1')

    expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('keeps calling later listeners and resolves set when a listener throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = new LocalStorageAdapter()
    const next = vi.fn()
    adapter.onChange(() => {
      throw new Error('boom')
    })
    adapter.onChange(next)

    await expect(adapter.set('k', 1)).resolves.toBeUndefined()

    expect(next).toHaveBeenCalledWith('k', 1)
    expect(error).toHaveBeenCalledWith('Storage change listener failed.', expect.any(Error))
  })

  it('rejects set and notifies nobody when setItem throws', async () => {
    const adapter = new LocalStorageAdapter()
    const listener = vi.fn()
    adapter.onChange(listener)
    vi.spyOn(web.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    await expect(adapter.set('k', 1)).rejects.toThrow('quota')

    expect(listener).not.toHaveBeenCalled()
  })
})

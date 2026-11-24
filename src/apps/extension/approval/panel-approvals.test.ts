import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeChrome } from '@/test/fake-chrome'

let env: ReturnType<typeof installFakeChrome>
let startInboxBridge: ReturnType<typeof vi.fn>
let watchWalletStorage: ReturnType<typeof vi.fn>

async function load(surface: string) {
  vi.resetModules()
  startInboxBridge = vi.fn()
  watchWalletStorage = vi.fn()
  vi.doMock('../surface', () => ({ surface }))
  vi.doMock('@/core/inpage-approval-bridge', () => ({ startInboxBridge }))
  vi.doMock('@/core/composables/useDappApprovals', () => ({ watchWalletStorage }))
  const { startPanelApprovals } = await import('./panel-approvals')
  return startPanelApprovals
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
})

afterEach(() => {
  vi.doUnmock('../surface')
  vi.doUnmock('@/core/inpage-approval-bridge')
  vi.doUnmock('@/core/composables/useDappApprovals')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('startPanelApprovals', () => {
  it('starts the panel bridge for the window the panel is in', async () => {
    const startPanelApprovals = await load('sidepanel')

    expect(await startPanelApprovals()).toBe(true)

    expect(watchWalletStorage).toHaveBeenCalledOnce()
    expect(startInboxBridge).toHaveBeenCalledOnce()
    expect(startInboxBridge).toHaveBeenCalledWith({ kind: 'panel', windowId: 202 })
  })

  it('starts nothing when the side panel page is open in a tab', async () => {
    env.chrome.tabs.getCurrent.mockResolvedValue({ id: 9 })
    const startPanelApprovals = await load('sidepanel')

    expect(await startPanelApprovals()).toBe(false)

    expect(startInboxBridge).not.toHaveBeenCalled()
    expect(watchWalletStorage).not.toHaveBeenCalled()
    expect(env.chrome.runtime.connect).not.toHaveBeenCalled()
  })

  it.each(['popup', 'tab', 'window', 'approval'])(
    'starts nothing on the %s surface and calls no chrome api',
    async (surface) => {
      const startPanelApprovals = await load(surface)

      expect(await startPanelApprovals()).toBe(false)

      expect(env.chrome.tabs.getCurrent).not.toHaveBeenCalled()
      expect(env.chrome.windows.getCurrent).not.toHaveBeenCalled()
      expect(startInboxBridge).not.toHaveBeenCalled()
    }
  )

  it('starts nothing when the window has no id', async () => {
    env.chrome.windows.getCurrent.mockResolvedValue({})
    const startPanelApprovals = await load('sidepanel')

    expect(await startPanelApprovals()).toBe(false)

    expect(startInboxBridge).not.toHaveBeenCalled()
  })

  it('resolves false without throwing when the tab lookup rejects', async () => {
    env.chrome.tabs.getCurrent.mockRejectedValue(new Error('no tab api'))
    const startPanelApprovals = await load('sidepanel')

    expect(await startPanelApprovals()).toBe(false)

    expect(startInboxBridge).not.toHaveBeenCalled()
  })
})

describe('rejectAllPending', () => {
  async function loadReject() {
    vi.resetModules()
    vi.doMock('../surface', () => ({ surface: 'sidepanel' }))
    vi.doMock('@/core/inpage-approval-bridge', () => ({ startInboxBridge: vi.fn() }))
    vi.doMock('@/core/composables/useDappApprovals', () => ({ watchWalletStorage: vi.fn() }))
    return (await import('./panel-approvals')).rejectAllPending
  }

  function queue(ids: string[]) {
    const pending = [...ids]
    const rejected: string[] = []
    return {
      rejected,
      currentId: () => pending[0],
      reject: vi.fn(async (id: string) => {
        rejected.push(id)
        pending.shift()
      }),
    }
  }

  it('rejects every pending request, head first', async () => {
    const rejectAllPending = await loadReject()
    const q = queue(['a', 'b', 'c'])

    await rejectAllPending(q)

    expect(q.rejected).toEqual(['a', 'b', 'c'])
    expect(q.currentId()).toBeUndefined()
  })

  it('does nothing for an empty queue', async () => {
    const rejectAllPending = await loadReject()
    const q = queue([])

    await rejectAllPending(q)

    expect(q.reject).not.toHaveBeenCalled()
  })

  it('stops when a rejection leaves the same head in place', async () => {
    const rejectAllPending = await loadReject()
    const reject = vi.fn(async () => {})

    await rejectAllPending({ currentId: () => 'stuck', reject })

    expect(reject).toHaveBeenCalledTimes(1)
  })

  it('propagates a handler failure and rejects nothing further', async () => {
    const rejectAllPending = await loadReject()
    const reject = vi.fn(async () => {
      throw new Error('boom')
    })

    await expect(rejectAllPending({ currentId: () => 'a', reject })).rejects.toThrow('boom')
    expect(reject).toHaveBeenCalledTimes(1)
  })
})

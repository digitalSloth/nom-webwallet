import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SESSION_KEY_PENDING_REQUESTS } from '@/config'
import type { InboxEntry } from '@/core/inpage-protocol'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'

const ACCOUNT = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'

function entry(id: string, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id,
    origin: 'https://dapp.example',
    tabId: 5,
    frameId: 0,
    method: 'znn_connect',
    params: undefined,
    account: ACCOUNT,
    chainId: 1,
    createdAt: 0,
    ...overrides,
  }
}

let env: ReturnType<typeof installFakeChrome>
let approvals: typeof import('@/core/dapp-approvals')

async function start(
  host: { kind: 'window' } | { kind: 'panel'; windowId: number },
  entries: InboxEntry[]
) {
  env.session.data[SESSION_KEY_PENDING_REQUESTS] = entries
  approvals = await import('@/core/dapp-approvals')
  const bridge = await import('@/core/inpage-approval-bridge')
  bridge.startInboxBridge(host)
  await settleStorage()
}

async function setInbox(entries: InboxEntry[]) {
  env.session.data[SESSION_KEY_PENDING_REQUESTS] = entries
  env.emitStorageChange({ [SESSION_KEY_PENDING_REQUESTS]: { newValue: entries } }, 'session')
  await settleStorage()
}

const queued = () => approvals.listApprovals().map((a) => a.id)

const MIXED = () => [
  entry('ip:window', { windowId: 202 }),
  entry('ip:panel', { panelWindowId: 202 }),
  entry('ip:other-panel', { panelWindowId: 303 }),
  entry('ip:other-window', { windowId: 303 }),
]

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
  vi.stubGlobal('location', { search: '?panel=tok-1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('inbox bridge panel host', () => {
  it('claims only the entries bound to its window panel', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())

    expect(queued()).toEqual(['ip:panel'])
  })

  it('is not claimed by the window host of the same browser window', async () => {
    await start({ kind: 'window' }, MIXED())

    expect(queued()).toEqual(['ip:window'])
  })

  it('posts the settle message the window host posts, and rebinds a connect', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())
    env.chrome.runtime.sendMessage.mockResolvedValue({ ok: true })

    await approvals.getHandlers('ip:panel')?.reject({ reason: 'userRejected' })
    expect(await approvals.getHandlers('ip:panel')?.rebind?.('z1other')).toBe(true)

    expect(env.chrome.runtime.sendMessage.mock.calls.map((c) => c[0])).toEqual([
      {
        channel: 'internal',
        kind: 'approvals.settle',
        id: 'ip:panel',
        error: { code: 4001, message: 'User rejected the request.' },
      },
      { channel: 'internal', kind: 'approvals.rebind', id: 'ip:panel', account: 'z1other' },
    ])
  })

  it('opens one side panel port when an entry is bound', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())
    await setInbox([...MIXED(), entry('ip:panel2', { panelWindowId: 202 })])

    expect(env.chrome.runtime.connect).toHaveBeenCalledOnce()
    expect(env.chrome.runtime.connect).toHaveBeenCalledWith({ name: 'znn-side-panel' })
  })

  it('opens the port with no bound entry and posts its window id first', async () => {
    await start({ kind: 'panel', windowId: 202 }, [entry('ip:window', { windowId: 202 })])

    expect(env.chrome.runtime.connect).toHaveBeenCalledOnce()
    expect(env.clientPorts[0].postMessage).toHaveBeenCalledWith({
      windowId: 202,
      token: 'tok-1',
    })
  })

  it('opens the port for an empty inbox', async () => {
    await start({ kind: 'panel', windowId: 303 }, [])

    expect(env.clientPorts[0].postMessage).toHaveBeenCalledWith({
      windowId: 303,
      token: 'tok-1',
    })
  })

  it('opens no port for the window host', async () => {
    await start({ kind: 'window' }, MIXED())

    expect(env.chrome.runtime.connect).not.toHaveBeenCalled()
  })

  it('opens the port before it claims an entry', async () => {
    let queuedAtConnect: string[] | undefined
    env.chrome.runtime.connect.mockImplementationOnce((info: { name: string }) => {
      queuedAtConnect = approvals.listApprovals().map((a) => a.id)
      return {
        name: info.name,
        onDisconnect: { addListener: () => {} },
        postMessage: () => {},
      } as never
    })
    await start({ kind: 'panel', windowId: 202 }, MIXED())

    expect(queuedAtConnect).toEqual([])
    expect(queued()).toEqual(['ip:panel'])
  })

  it('reconnects after the port drops while a bound entry remains', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())

    env.clientPorts[0].drop()
    await settleStorage()

    expect(env.chrome.runtime.connect).toHaveBeenCalledTimes(2)
    expect(queued()).toEqual(['ip:panel'])
  })

  it('reconnects after the port drops even when no entry remains', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())
    await setInbox([entry('ip:window', { windowId: 202 })])

    env.clientPorts[0].drop()
    await settleStorage()

    expect(env.chrome.runtime.connect).toHaveBeenCalledTimes(2)
    expect(env.clientPorts[1].postMessage).toHaveBeenCalledWith({
      windowId: 202,
      token: 'tok-1',
    })
  })

  it('never disconnects its own port', async () => {
    await start({ kind: 'panel', windowId: 202 }, MIXED())
    await setInbox([])

    expect(env.clientPorts[0].disconnect).not.toHaveBeenCalled()
  })
})

describe.each([
  ['window', { kind: 'window' as const }, 'ip:window'],
  ['panel', { kind: 'panel' as const, windowId: 202 }, 'ip:panel'],
])('inbox bridge %s host drops answered requests', (_name, host, id) => {
  it('removes a request once its entry leaves the inbox', async () => {
    await start(host, MIXED())
    expect(queued()).toEqual([id])

    await setInbox(MIXED().filter((e) => e.id !== id))

    expect(approvals.listApprovals()).toEqual([])
    expect(approvals.getHandlers(id)).toBeUndefined()
  })

  it('removes a request once its entry is bound elsewhere', async () => {
    await start(host, MIXED())

    await setInbox(
      MIXED().map((e) => (e.id === id ? { ...e, windowId: 909, panelWindowId: undefined } : e))
    )

    expect(approvals.listApprovals()).toEqual([])
  })

  it('keeps a request that is still bound', async () => {
    await start(host, MIXED())

    await setInbox(MIXED())

    expect(queued()).toEqual([id])
  })
})

describe('panel port hello', () => {
  it('posts nothing when the panel document has no token', async () => {
    vi.stubGlobal('location', { search: '' })
    await start({ kind: 'panel', windowId: 202 }, [])

    expect(env.clientPorts[0].postMessage).not.toHaveBeenCalled()
  })

  describe('with a document', () => {
    function stubDocument(state: 'visible' | 'hidden') {
      const doc = Object.assign(new EventTarget(), { visibilityState: state })
      vi.stubGlobal('document', doc)
      return doc
    }

    const show = (doc: { visibilityState: string } & EventTarget) => {
      doc.visibilityState = 'visible'
      doc.dispatchEvent(new Event('visibilitychange'))
    }

    it('keeps its port without a hello while hidden, then posts it once visible', async () => {
      const doc = stubDocument('hidden')
      await start({ kind: 'panel', windowId: 202 }, [])

      expect(env.chrome.runtime.connect).toHaveBeenCalledTimes(1)
      expect(env.clientPorts[0].postMessage).not.toHaveBeenCalled()

      show(doc)

      expect(env.clientPorts[0].postMessage).toHaveBeenCalledTimes(1)
      expect(env.clientPorts[0].postMessage).toHaveBeenCalledWith({
        windowId: 202,
        token: 'tok-1',
      })
    })

    it('installs the visibility watcher once across reconnects', async () => {
      const doc = stubDocument('hidden')
      await start({ kind: 'panel', windowId: 202 }, [])
      env.clientPorts[0].drop()
      await settleStorage()
      expect(env.chrome.runtime.connect).toHaveBeenCalledTimes(2)

      show(doc)

      expect(env.clientPorts[0].postMessage).not.toHaveBeenCalled()
      expect(env.clientPorts[1].postMessage).toHaveBeenCalledTimes(1)
    })

    it('posts the hello at once when the document is visible', async () => {
      stubDocument('visible')
      await start({ kind: 'panel', windowId: 202 }, [])

      expect(env.clientPorts[0].postMessage).toHaveBeenCalledTimes(1)
    })
  })
})

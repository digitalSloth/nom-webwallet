import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InboxEntry } from '@/core/inpage-protocol'
import { createFakePort, installFakeChrome } from '@/test/fake-chrome'

type Inbox = typeof import('@/sw/approval-inbox')

const OUTCOMES_KEY = 'nom-wallet.outcomes'

function entry(id: string, overrides: Partial<InboxEntry> = {}): InboxEntry {
  return {
    id,
    origin: 'https://dapp.example',
    tabId: 5,
    frameId: 0,
    method: 'znn_connect',
    params: undefined,
    account: 'z1account',
    chainId: 1,
    createdAt: 0,
    ...overrides,
  }
}

let env: ReturnType<typeof installFakeChrome>
let inbox: Inbox

beforeEach(async () => {
  vi.resetModules()
  env = installFakeChrome()
  inbox = await import('@/sw/approval-inbox')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('approval inbox', () => {
  it('keeps a request that arrives while another is being stamped', async () => {
    await inbox.addToInbox(entry('ip:a'))

    await Promise.all([inbox.stampWindow(7), inbox.addToInbox(entry('ip:b'))])

    const entries = await inbox.listInbox()
    expect(entries.map((e) => e.id)).toEqual(['ip:a', 'ip:b'])
    expect(entries[0].windowId).toBe(7)
  })

  it('adds a re-sent request only once', async () => {
    const results = await Promise.all([
      inbox.addToInbox(entry('ip:a')),
      inbox.addToInbox(entry('ip:a')),
    ])

    expect(results).toEqual(['added', 'tracked'])
    expect(await inbox.listInbox()).toHaveLength(1)
  })

  it('reports an id with a stored outcome as tracked rather than adding it again', async () => {
    await inbox.addToInbox(entry('ip:a'))
    await inbox.settle('ip:a', { result: 'z1account' })

    expect(await inbox.addToInbox(entry('ip:a'))).toBe('tracked')
    expect(await inbox.listInbox()).toEqual([])
  })

  it('caps the inbox at five pending requests', async () => {
    for (const id of ['1', '2', '3', '4', '5']) {
      await inbox.addToInbox(
        entry(`ip:${id}`, { origin: `https://site${id}.example`, tabId: Number(id) })
      )
    }

    expect(
      await inbox.addToInbox(entry('ip:6', { origin: 'https://site6.example', tabId: 6 }))
    ).toBe('full')
  })

  it('caps one origin at three pending requests and lets other origins queue', async () => {
    for (const id of ['1', '2', '3']) {
      expect(await inbox.addToInbox(entry(`ip:${id}`))).toBe('added')
    }

    expect(await inbox.addToInbox(entry('ip:4'))).toBe('full')
    expect(
      await inbox.addToInbox(entry('ip:5', { origin: 'https://other.example', tabId: 6 }))
    ).toBe('added')
    expect(
      await inbox.addToInbox(entry('ip:6', { origin: 'https://third.example', tabId: 7 }))
    ).toBe('added')
    expect(
      await inbox.addToInbox(entry('ip:7', { origin: 'https://fourth.example', tabId: 8 }))
    ).toBe('full')
  })

  it('caps one tab at three pending requests across the origins of its frames', async () => {
    const frame = (id: string, origin: string, tabId = 5) => entry(`ip:${id}`, { origin, tabId })

    expect(await inbox.addToInbox(frame('1', 'https://top.example'))).toBe('added')
    expect(await inbox.addToInbox(frame('2', 'https://ads.example'))).toBe('added')
    expect(await inbox.addToInbox(frame('3', 'https://widget.example'))).toBe('added')

    expect(await inbox.addToInbox(frame('4', 'https://ads.example'))).toBe('full')
    expect(await inbox.addToInbox(frame('5', 'https://new.example'))).toBe('full')
    expect(await inbox.addToInbox(frame('6', 'https://top.example', 6))).toBe('added')
  })

  it('frees a slot of the origin when one of its requests settles', async () => {
    for (const id of ['1', '2', '3']) await inbox.addToInbox(entry(`ip:${id}`))
    expect(await inbox.addToInbox(entry('ip:4'))).toBe('full')

    await inbox.settle('ip:1', { result: 'z1account' })

    expect(await inbox.addToInbox(entry('ip:4'))).toBe('added')
  })

  it('still reports a re-sent request of a full origin as tracked', async () => {
    for (const id of ['1', '2', '3']) await inbox.addToInbox(entry(`ip:${id}`))

    expect(await inbox.addToInbox(entry('ip:2'))).toBe('tracked')
  })

  it('never reports an id as unknown while it is being settled', async () => {
    await inbox.addToInbox(entry('ip:a'))

    let done = false
    const settling = inbox.settle('ip:a', { result: 'z1account' }).then(() => {
      done = true
    })
    const observed: boolean[] = []
    while (!done) observed.push(await inbox.isTracked('ip:a'))
    await settling

    expect(observed.length).toBeGreaterThan(0)
    expect(observed.every(Boolean)).toBe(true)
  })

  it('settles once when a window-close rejection races an approval', async () => {
    const { registerPort } = await import('@/sw/ports')
    const port = createFakePort('https://dapp.example', 5)
    registerPort(port as unknown as chrome.runtime.Port)
    await inbox.addToInbox(entry('ip:a', { windowId: 7 }))
    const grant = vi.fn(async () => {})
    const grantOnRejection = vi.fn(async () => {})

    await Promise.all([
      inbox.settle('ip:a', { result: 'z1account' }, grant),
      inbox.rejectEntriesForWindow(7, { code: 4001, message: 'The approval window was closed.' }),
      inbox.settle('ip:a', { error: { code: 4001, message: 'User rejected.' } }, grantOnRejection),
    ])

    expect(port.posted).toEqual([
      { kind: 'outcome', id: 'ip:a', result: 'z1account', error: undefined },
    ])
    expect(grant).toHaveBeenCalledOnce()
    expect(grantOnRejection).not.toHaveBeenCalled()
    expect(env.session.data[OUTCOMES_KEY]).toEqual([
      expect.objectContaining({ id: 'ip:a', result: 'z1account', deliveredAt: expect.any(Number) }),
    ])
  })

  it('rejects only the closed window’s entries', async () => {
    await inbox.addToInbox(entry('ip:a', { windowId: 7 }))
    await inbox.addToInbox(entry('ip:b', { windowId: 8 }))

    await inbox.rejectEntriesForWindow(7, { code: 4001, message: 'closed' })

    expect((await inbox.listInbox()).map((e) => e.id)).toEqual(['ip:b'])
    expect(await inbox.isTracked('ip:a')).toBe(true)
  })

  it('opens one approval window for requests that arrive together', async () => {
    await inbox.addToInbox(entry('ip:a'))
    await inbox.addToInbox(entry('ip:b'))

    await Promise.all([inbox.openOrFocusApprovalWindow(), inbox.openOrFocusApprovalWindow()])

    expect(env.chrome.windows.create).toHaveBeenCalledOnce()
    expect(env.chrome.windows.update).toHaveBeenCalledWith(101, { focused: true })
    expect((await inbox.listInbox()).map((e) => e.windowId)).toEqual([101, 101])
  })

  it('opens the approval window at 420x680', async () => {
    await inbox.openOrFocusApprovalWindow()

    expect(env.chrome.windows.create).toHaveBeenCalledWith(
      expect.objectContaining({ width: 420, height: 680 })
    )
  })

  it('throws when the approval window cannot be created', async () => {
    env.chrome.windows.create.mockResolvedValueOnce({} as { id: number })

    await expect(inbox.openOrFocusApprovalWindow()).rejects.toThrow(/without an id/)
  })
})

describe('approval inbox side panel entries', () => {
  const CLOSED = { code: 4001, message: 'The approval window was closed.' }

  it('stamps an unbound entry with the window and leaves a panel entry unstamped', async () => {
    await inbox.addToInbox(entry('ip:a'))
    await inbox.addToInbox(entry('ip:panel', { panelWindowId: 202 }))

    await inbox.openOrFocusApprovalWindow()

    const [unbound, panel] = await inbox.listInbox()
    expect(unbound.windowId).toBe(101)
    expect(panel.panelWindowId).toBe(202)
    expect(panel.windowId).toBeUndefined()
  })

  it('rejects the window entries and the panel entries of a closed browser window', async () => {
    await inbox.addToInbox(entry('ip:window', { windowId: 202 }))
    await inbox.addToInbox(entry('ip:panel', { panelWindowId: 202 }))
    await inbox.addToInbox(entry('ip:other', { panelWindowId: 303 }))

    await inbox.rejectEntriesForWindow(202, CLOSED)

    expect((await inbox.listInbox()).map((e) => e.id)).toEqual(['ip:other'])
  })

  it('rejects only the panel entries of a closed side panel', async () => {
    await inbox.addToInbox(entry('ip:window', { windowId: 202 }))
    await inbox.addToInbox(entry('ip:panel', { panelWindowId: 202 }))
    await inbox.addToInbox(entry('ip:other', { panelWindowId: 303 }))

    await inbox.rejectEntriesForPanel(202, CLOSED)

    expect((await inbox.listInbox()).map((e) => e.id)).toEqual(['ip:window', 'ip:other'])
    expect(await inbox.isTracked('ip:panel')).toBe(true)
  })

  it('delivers the closed error to the dApp and never as an approval', async () => {
    const { registerPort } = await import('@/sw/ports')
    const port = createFakePort('https://dapp.example', 5)
    registerPort(port as unknown as chrome.runtime.Port)
    await inbox.addToInbox(entry('ip:panel', { panelWindowId: 202 }))

    await inbox.rejectEntriesForPanel(202, inbox.APPROVAL_CLOSED_ERROR)

    expect(port.posted).toEqual([
      { kind: 'outcome', id: 'ip:panel', result: undefined, error: CLOSED },
    ])
  })

  it('settles once when a panel-close rejection races an approval', async () => {
    const { registerPort } = await import('@/sw/ports')
    const port = createFakePort('https://dapp.example', 5)
    registerPort(port as unknown as chrome.runtime.Port)
    await inbox.addToInbox(entry('ip:a', { panelWindowId: 202 }))
    const grant = vi.fn(async () => {})
    const grantOnRejection = vi.fn(async () => {})

    await Promise.all([
      inbox.settle('ip:a', { result: 'z1account' }, grant),
      inbox.rejectEntriesForPanel(202, CLOSED),
      inbox.settle('ip:a', { error: { code: 4001, message: 'User rejected.' } }, grantOnRejection),
    ])

    expect(port.posted).toEqual([
      { kind: 'outcome', id: 'ip:a', result: 'z1account', error: undefined },
    ])
    expect(grant).toHaveBeenCalledOnce()
    expect(grantOnRejection).not.toHaveBeenCalled()
  })
})

describe('rebindConnect', () => {
  const STORED = 'z1stored'
  const HIDDEN = 'z1hidden'

  function storeWallets(): void {
    env.local.data['nom-wallet-storage'] = {
      wallets: [
        {
          baseAddress: 'z1base',
          accounts: [
            { address: STORED, index: 0 },
            { address: HIDDEN, index: 1, hidden: true },
          ],
        },
      ],
    }
  }

  beforeEach(storeWallets)

  it('replaces only the account of a connect entry', async () => {
    await inbox.addToInbox(
      entry('ip:a', { windowId: 7, title: 'dApp', favicon: 'https://f/x.png' })
    )
    const before = (await inbox.listInbox())[0]

    expect(await inbox.rebindConnect('ip:a', STORED)).toBe(true)

    const [after] = await inbox.listInbox()
    expect(after.account).toBe(STORED)
    expect(after).toEqual({ ...before, account: STORED })
  })

  it('accepts a hidden account of a stored wallet', async () => {
    await inbox.addToInbox(entry('ip:a'))

    expect(await inbox.rebindConnect('ip:a', HIDDEN)).toBe(true)
    expect((await inbox.listInbox())[0].account).toBe(HIDDEN)
  })

  it.each([
    ['znn_sign', { method: 'znn_sign' as const, params: 'hello' }],
    ['znn_sendTransaction', { method: 'znn_sendTransaction' as const }],
  ])('refuses a %s entry and leaves the inbox unchanged', async (_name, over) => {
    await inbox.addToInbox(entry('ip:a', over))
    const before = await inbox.listInbox()

    expect(await inbox.rebindConnect('ip:a', STORED)).toBe(false)
    expect(await inbox.listInbox()).toEqual(before)
  })

  it('refuses an unknown id', async () => {
    await inbox.addToInbox(entry('ip:a'))
    const before = await inbox.listInbox()

    expect(await inbox.rebindConnect('ip:zzz', STORED)).toBe(false)
    expect(await inbox.listInbox()).toEqual(before)
  })

  it('refuses an id that was already settled', async () => {
    await inbox.addToInbox(entry('ip:a'))
    await inbox.settle('ip:a', { result: 'z1account' })

    expect(await inbox.rebindConnect('ip:a', STORED)).toBe(false)
    expect(await inbox.listInbox()).toEqual([])
  })

  it('refuses an address in no stored wallet', async () => {
    await inbox.addToInbox(entry('ip:a'))

    expect(await inbox.rebindConnect('ip:a', 'z1stranger')).toBe(false)
    expect(await inbox.rebindConnect('ip:a', '')).toBe(false)
    expect((await inbox.listInbox())[0].account).toBe('z1account')
  })

  it('refuses when no wallet storage exists', async () => {
    delete env.local.data['nom-wallet-storage']
    await inbox.addToInbox(entry('ip:a'))

    expect(await inbox.rebindConnect('ip:a', STORED)).toBe(false)
    expect((await inbox.listInbox())[0].account).toBe('z1account')
  })

  it('settles once and refuses the rebind when both race', async () => {
    const { registerPort } = await import('@/sw/ports')
    const port = createFakePort('https://dapp.example', 5)
    registerPort(port as unknown as chrome.runtime.Port)
    await inbox.addToInbox(entry('ip:a'))

    const [, rebound] = await Promise.all([
      inbox.settle('ip:a', { result: 'z1account' }),
      inbox.rebindConnect('ip:a', STORED),
    ])

    expect(rebound).toBe(false)
    expect(port.posted).toHaveLength(1)
    expect(await inbox.listInbox()).toEqual([])
  })
})

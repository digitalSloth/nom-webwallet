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
    for (const id of ['1', '2', '3', '4', '5']) await inbox.addToInbox(entry(`ip:${id}`))

    expect(await inbox.addToInbox(entry('ip:6'))).toBe('full')
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

  it('throws when the approval window cannot be created', async () => {
    env.chrome.windows.create.mockResolvedValueOnce({} as { id: number })

    await expect(inbox.openOrFocusApprovalWindow()).rejects.toThrow(/without an id/)
  })
})

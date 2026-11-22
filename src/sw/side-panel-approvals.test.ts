import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SESSION_KEY_PENDING_REQUESTS,
  SESSION_KEY_SIDE_PANELS,
  STORAGE_KEY_SIDE_PANEL,
} from '@/config'
import type { InboxEntry } from '@/core/inpage-protocol'
import {
  createFakePanelPort,
  createFakePort,
  installFakeChrome,
  panelTokenFor,
  settleStorage,
  sidePanelContext,
} from '@/test/fake-chrome'

const PANEL = sidePanelContext('panel-doc')

function hello(windowId = 202, documentId = 'panel-doc') {
  return { windowId, token: panelTokenFor(documentId) }
}
const CLOSED = { code: 4001, message: 'The approval window was closed.' }

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

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  env = installFakeChrome()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function load() {
  const module = await import('@/sw/side-panel-approvals')
  await settleStorage()
  return module
}

function seed(entries: InboxEntry[]) {
  env.session.data[SESSION_KEY_PENDING_REQUESTS] = entries
}

function inboxIds(): string[] {
  const stored = env.session.data[SESSION_KEY_PENDING_REQUESTS] as InboxEntry[]
  return stored.map((e) => e.id)
}

function registry(): Record<string, string> {
  return (env.session.data[SESSION_KEY_SIDE_PANELS] as Record<string, string> | undefined) ?? {}
}

/** Opens a panel the way a real one does: a SIDE_PANEL context, then a port that names its window. */
async function openPanel(documentId = 'panel-doc', windowId = 202) {
  env.contexts.push(sidePanelContext(documentId))
  const port = createFakePanelPort()
  env.connect(port)
  port.receive(hello(windowId, documentId))
  await settleStorage()
  return port
}

/** Panels already open and registered when the worker starts. */
function preRegister(panels: Record<string, string>) {
  env.session.data[SESSION_KEY_SIDE_PANELS] = panels
  for (const documentId of Object.values(panels)) env.contexts.push(sidePanelContext(documentId))
}

function closePanelContext(documentId = 'panel-doc') {
  const index = env.contexts.findIndex((c) => c.documentId === documentId)
  if (index >= 0) env.contexts.splice(index, 1)
}

describe('panelWindowFor', () => {
  it('binds a registered open panel that Chrome reports with window id -1', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel()

    expect(await panelWindowFor(202)).toBe(202)
    expect(env.chrome.runtime.getContexts).toHaveBeenLastCalledWith({ documentIds: ['panel-doc'] })
  })

  it.each([
    ['absent', undefined],
    ['false', false],
    ['the string true', 'true'],
  ])('never looks up contexts when the setting is %s', async (_name, value) => {
    if (value !== undefined) env.local.data[STORAGE_KEY_SIDE_PANEL] = value
    const { panelWindowFor } = await load()
    await openPanel()
    env.chrome.runtime.getContexts.mockClear()

    expect(await panelWindowFor(202)).toBeUndefined()
    expect(env.chrome.runtime.getContexts).not.toHaveBeenCalled()
  })

  it('returns undefined for an open panel that never registered', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    env.contexts.push(PANEL)
    const { panelWindowFor } = await load()

    expect(await panelWindowFor(202)).toBeUndefined()
  })

  it('returns undefined for a panel registered in another window', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel('panel-doc', 303)

    expect(await panelWindowFor(202)).toBeUndefined()
  })

  it('returns undefined when the registered panel is gone', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel()
    closePanelContext()

    expect(await panelWindowFor(202)).toBeUndefined()
  })

  it.each([
    ['a tab context', { ...PANEL, contextType: 'TAB' }],
    ['a panel subframe', { ...PANEL, frameId: 4 }],
  ])('returns undefined when the registered document is %s', async (_name, replacement) => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel()
    env.contexts.splice(0, env.contexts.length, replacement)

    expect(await panelWindowFor(202)).toBeUndefined()
  })

  it('returns undefined without throwing when the lookup rejects', async () => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel()
    env.chrome.runtime.getContexts.mockRejectedValue(new Error('no contexts'))

    expect(await panelWindowFor(202)).toBeUndefined()
  })

  it.each([
    ['undefined', undefined],
    ['negative', -1],
  ])('returns undefined for a %s window id', async (_name, windowId) => {
    env.local.data[STORAGE_KEY_SIDE_PANEL] = true
    const { panelWindowFor } = await load()
    await openPanel()
    env.chrome.runtime.getContexts.mockClear()

    expect(await panelWindowFor(windowId)).toBeUndefined()
    expect(env.chrome.runtime.getContexts).not.toHaveBeenCalled()
  })
})

describe('side panel registration', () => {
  it('records the window and document of a verified panel port', async () => {
    await load()
    await openPanel()

    expect(registry()).toEqual({ '202': 'panel-doc' })
  })

  it('keeps the latest panel of a window', async () => {
    await load()
    await openPanel('panel-a')
    await openPanel('panel-b')

    expect(registry()).toEqual({ '202': 'panel-b' })
  })

  it('re-registers on a re-sent hello after sidePanel.onClosed', async () => {
    const fire = env.installOnClosed()
    await load()
    const port = await openPanel()
    fire({ windowId: 202, path: 'sidepanel.html' })
    await settleStorage()
    expect(registry()).toEqual({})

    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({ '202': 'panel-doc' })
  })

  it('drops the record when a re-sent hello carries a bad token', async () => {
    await load()
    const port = await openPanel()

    port.receive({ windowId: 202, token: 'forged' })
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it('does not overwrite the record of another panel on a bad re-sent hello', async () => {
    await load()
    const port = await openPanel('panel-a')
    await openPanel('panel-b')

    port.receive({ windowId: 202, token: 'forged' })
    await settleStorage()

    expect(registry()).toEqual({ '202': 'panel-b' })
  })

  it('records a panel whose window id arrives before verification ends', async () => {
    await load()
    let release: (contexts: unknown[]) => void = () => {}
    env.chrome.runtime.getContexts.mockImplementation(
      () => new Promise((resolve) => (release = resolve as typeof release))
    )
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello())
    await settleStorage()
    release([PANEL])
    await settleStorage()

    expect(registry()).toEqual({ '202': 'panel-doc' })
  })

  it('records a panel whose sender has only id, url and origin', async () => {
    await load()
    env.contexts.push(PANEL)
    const port = createFakePanelPort()
    expect(Object.keys(port.sender).sort()).toEqual(['id', 'origin', 'url'])
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({ '202': 'panel-doc' })
  })

  it('accepts a sender document id that matches the tagged panel and ignores the url query', async () => {
    await load()
    env.contexts.push(PANEL)
    const port = createFakePanelPort('chrome-extension://wallet/sidepanel.html?panel=x#/send')
    port.sender.documentId = 'panel-doc'
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({ '202': 'panel-doc' })
  })

  it.each([
    ['a wrong token', { windowId: 202, token: 'wrong' }],
    ['no token', { windowId: 202 }],
    ['an empty token', { windowId: 202, token: '' }],
    ['a numeric token', { windowId: 202, token: 5 }],
  ])('records nothing for a hello with %s', async (_name, message) => {
    await load()
    env.contexts.push(PANEL)
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(message)
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it('records nothing when two contexts carry the token', async () => {
    await load()
    env.contexts.push(PANEL, { ...PANEL, documentId: 'copy-doc' })
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it('tells two panels apart by token', async () => {
    await load()
    await openPanel('panel-a', 202)
    await openPanel('panel-b', 303)

    expect(registry()).toEqual({ '202': 'panel-a', '303': 'panel-b' })
  })

  it('ignores a port with another name', async () => {
    await load()
    env.contexts.push(PANEL)
    const port = createFakePanelPort()
    port.name = 'znn-provider'
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it.each([
    ['a web page url', () => createFakePanelPort('https://dapp.example/')],
    [
      'a url that only contains the extension origin',
      () => createFakePanelPort('https://evil.example/chrome-extension://wallet/sidepanel.html'),
    ],
    [
      'a tab sender',
      () => {
        const port = createFakePanelPort()
        port.sender.tab = { id: 9 }
        return port
      },
    ],
    ['another extension page', () => createFakePanelPort('chrome-extension://wallet/popup.html')],
    [
      'a sender document id that is not the tagged panel',
      () => {
        const port = createFakePanelPort()
        port.sender.documentId = 'other-doc'
        return port
      },
    ],
  ])('records nothing for a port with %s', async (_name, build) => {
    await load()
    env.contexts.push(PANEL)
    const port = build()
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it.each([
    ['a tab context', [{ ...PANEL, contextType: 'TAB', tabId: 9, windowId: 202 }]],
    ['a popup context', [{ ...PANEL, contextType: 'POPUP' }]],
    ['a panel subframe', [{ ...PANEL, frameId: 3 }]],
    ['two contexts', [PANEL, PANEL]],
  ])('records nothing when the document is %s', async (_name, contexts) => {
    await load()
    env.contexts.push(...contexts)
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it('records nothing when the document lookup rejects', async () => {
    await load()
    env.chrome.runtime.getContexts.mockRejectedValue(new Error('gone'))
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello())
    await settleStorage()

    expect(registry()).toEqual({})
  })

  it.each([
    ['no window id', {}],
    ['a negative window id', { windowId: -1 }],
    ['a string window id', { windowId: '202' }],
    ['no object', 'hello'],
  ])('records nothing for a message with %s', async (_name, message) => {
    await load()
    env.contexts.push(PANEL)
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(message)
    await settleStorage()

    expect(registry()).toEqual({})
  })
})

describe('side panel port close', () => {
  async function setup() {
    seed([
      entry('ip:panel', { panelWindowId: 202 }),
      entry('ip:other-panel', { panelWindowId: 303 }),
      entry('ip:window', { windowId: 101 }),
    ])
    preRegister({ '202': 'panel-doc', '303': 'other-doc' })
    const { registerPort } = await import('@/sw/ports')
    const dapp = createFakePort('https://dapp.example', 5)
    registerPort(dapp as unknown as chrome.runtime.Port)
    await load()
    const panel = createFakePanelPort()
    env.connect(panel)
    panel.receive(hello())
    await settleStorage()
    return { dapp, panel }
  }

  it('rejects only the entries of the panel window, drops its record and tells the dApp', async () => {
    const { dapp, panel } = await setup()
    closePanelContext()

    panel.close()
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:other-panel', 'ip:window'])
    expect(registry()).toEqual({ '303': 'other-doc' })
    expect(dapp.posted).toEqual([
      { kind: 'outcome', id: 'ip:panel', result: undefined, error: CLOSED },
    ])
  })

  it('keeps the record of a newer panel in the same window', async () => {
    const { panel } = await setup()
    await openPanel('newer-doc', 202)

    panel.close()
    await settleStorage()

    expect(registry()).toEqual({ '202': 'newer-doc', '303': 'other-doc' })
  })

  it('handles a close that arrives before the panel is verified', async () => {
    await setup()
    seed([entry('ip:late', { panelWindowId: 404 })])
    let release: (contexts: unknown[]) => void = () => {}
    env.chrome.runtime.getContexts.mockImplementation(
      () => new Promise((resolve) => (release = resolve as typeof release))
    )
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello(404, 'late-doc'))
    await settleStorage()

    port.close()
    release([sidePanelContext('late-doc')])
    await settleStorage()

    expect(inboxIds()).toEqual([])
    expect(registry()['404']).toBeUndefined()
  })

  it('rejects nothing when an unverified port closes', async () => {
    await setup()
    const port = createFakePanelPort()
    env.connect(port)
    port.receive(hello(202, 'missing-doc'))

    port.close()
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:panel', 'ip:other-panel', 'ip:window'])
  })

  it('rejects nothing when a port closes before it names a window', async () => {
    await setup()
    const port = createFakePanelPort()
    env.connect(port)

    port.close()
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:panel', 'ip:other-panel', 'ip:window'])
  })
})

describe('sidePanel.onClosed', () => {
  async function setup() {
    seed([
      entry('ip:panel', { panelWindowId: 202 }),
      entry('ip:other-panel', { panelWindowId: 303 }),
      entry('ip:window', { windowId: 202 }),
    ])
    preRegister({ '202': 'panel-doc', '303': 'other-doc' })
    const fire = env.installOnClosed()
    await load()
    return fire
  }

  it('rejects the panel entries of the closed window and drops its record', async () => {
    const fire = await setup()

    fire({ windowId: 202, path: 'sidepanel.html' })
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:other-panel', 'ip:window'])
    expect(registry()).toEqual({ '303': 'other-doc' })
  })

  it('rejects when the event has no path', async () => {
    const fire = await setup()

    fire({ windowId: 202 })
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:other-panel', 'ip:window'])
  })

  it('ignores another panel path', async () => {
    const fire = await setup()

    fire({ windowId: 202, path: 'other.html' })
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:panel', 'ip:other-panel', 'ip:window'])
    expect(registry()).toEqual({ '202': 'panel-doc', '303': 'other-doc' })
  })

  it('ignores an event without a window id', async () => {
    const fire = await setup()

    fire({ path: 'sidepanel.html' })
    await settleStorage()

    expect(inboxIds()).toEqual(['ip:panel', 'ip:other-panel', 'ip:window'])
  })

  it('loads without the event on older Chrome', async () => {
    seed([entry('ip:panel', { panelWindowId: 202 })])
    env.session.data[SESSION_KEY_SIDE_PANELS] = { '202': 'panel-doc' }
    env.contexts.push(PANEL)

    await load()

    expect(inboxIds()).toEqual(['ip:panel'])
  })
})

describe('start-up sweep', () => {
  it('rejects the entries of a window whose panel is gone and keeps the open one', async () => {
    seed([
      entry('ip:closed', { panelWindowId: 202 }),
      entry('ip:open', { panelWindowId: 303 }),
      entry('ip:window', { windowId: 202 }),
    ])
    env.session.data[SESSION_KEY_SIDE_PANELS] = { '202': 'dead-doc', '303': 'panel-doc' }
    env.contexts.push(PANEL)
    const { registerPort } = await import('@/sw/ports')
    const dapp = createFakePort('https://dapp.example', 5)
    registerPort(dapp as unknown as chrome.runtime.Port)

    await load()

    expect(inboxIds()).toEqual(['ip:open', 'ip:window'])
    expect(registry()).toEqual({ '303': 'panel-doc' })
    expect(dapp.posted).toEqual([
      { kind: 'outcome', id: 'ip:closed', result: undefined, error: CLOSED },
    ])
  })

  it('rejects the entries of a window that has no registry record', async () => {
    seed([entry('ip:orphan', { panelWindowId: 202 })])

    await load()

    expect(inboxIds()).toEqual([])
  })

  it('drops a stale record that has no entries', async () => {
    env.session.data[SESSION_KEY_SIDE_PANELS] = { '202': 'dead-doc' }

    await load()

    expect(registry()).toEqual({})
  })

  it('keeps every entry when the lookup rejects', async () => {
    seed([entry('ip:a', { panelWindowId: 202 }), entry('ip:b', { panelWindowId: 303 })])
    env.session.data[SESSION_KEY_SIDE_PANELS] = { '202': 'a-doc', '303': 'b-doc' }
    env.chrome.runtime.getContexts.mockRejectedValue(new Error('unavailable'))

    await load()

    expect(inboxIds()).toEqual(['ip:a', 'ip:b'])
    expect(registry()).toEqual({ '202': 'a-doc', '303': 'b-doc' })
  })

  it('looks nothing up when there is no record and no panel entry', async () => {
    seed([entry('ip:window', { windowId: 202 })])

    await load()

    expect(env.chrome.runtime.getContexts).not.toHaveBeenCalled()
    expect(inboxIds()).toEqual(['ip:window'])
  })
})

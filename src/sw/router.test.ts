import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { accountBlockProblem, sendTransactionParamsProblem } from '@/core/inpage-protocol'
import { encryptedMessageParamsProblem, sealMessage } from '@/core/message-envelope'
import { OTHER_ENTROPY, TEST_ENTROPY, testAccount, walletStorage } from '@/test/message-account'
import { sodiumSealPayload } from '@/test/sealed'

import {
  createFakePanelPort,
  panelTokenFor,
  createFakePort,
  installFakeChrome,
  settleStorage,
  sidePanelContext,
} from '@/test/fake-chrome'

const ORIGIN = 'https://dapp.example'
const ACCOUNT = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'

let env: ReturnType<typeof installFakeChrome>

beforeEach(async () => {
  vi.resetModules()
  env = installFakeChrome()
  env.local.data['nom-wallet-storage'] = {
    wallets: [{ baseAddress: ACCOUNT, accounts: [{ address: ACCOUNT, index: 0 }] }],
    activeWalletAddress: ACCOUNT,
    activeAccountAddress: ACCOUNT,
  }
  env.local.data['nom-wallet-chain-id'] = 3
  await import('@/sw/router')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function connectRequest(id: string) {
  return { kind: 'request', id, method: 'znn_connect', params: undefined }
}

describe('router prompting requests', () => {
  it('binds the inbox entry to the active account and chain', async () => {
    const port = createFakePort(ORIGIN, 5)
    env.connect(port)

    port.receive(connectRequest('ip:1'))
    await settleStorage()

    const { listInbox } = await import('@/sw/approval-inbox')
    expect(await listInbox()).toEqual([
      expect.objectContaining({ id: 'ip:1', account: ACCOUNT, chainId: 3, windowId: 101 }),
    ])
    expect(port.posted).toEqual([{ kind: 'accepted', id: 'ip:1' }])
  })

  it('settles the request with an error when the approval window cannot open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env.chrome.windows.create.mockRejectedValueOnce(new Error('No window could be created.'))
    const port = createFakePort(ORIGIN, 5)
    env.connect(port)

    port.receive(connectRequest('ip:1'))
    await settleStorage()

    expect(port.posted).toEqual([
      { kind: 'accepted', id: 'ip:1' },
      {
        kind: 'outcome',
        id: 'ip:1',
        result: undefined,
        error: { code: -32603, message: 'Could not open the approval window.' },
      },
    ])
    const { listInbox } = await import('@/sw/approval-inbox')
    expect(await listInbox()).toEqual([])
  })

  it('does not fill the inbox with requests that never got a window', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    env.chrome.windows.create.mockRejectedValue(new Error('No window could be created.'))
    const port = createFakePort(ORIGIN, 5)
    env.connect(port)

    for (let i = 0; i < 6; i++) {
      port.receive(connectRequest(`ip:${i}`))
      await settleStorage()
    }

    const errors = port.posted.filter(
      (m): m is { error: { message: string } } => (m as { kind: string }).kind === 'outcome'
    )
    expect(errors.map((m) => m.error.message)).not.toContain('Too many pending requests.')
  })
})

describe('router side panel routing', () => {
  const PANEL = sidePanelContext('panel-doc')

  async function request(windowId?: number) {
    const port = createFakePort(ORIGIN, 5, 0, windowId)
    env.connect(port)
    port.receive(connectRequest('ip:1'))
    await settleStorage()
    const { listInbox } = await import('@/sw/approval-inbox')
    return { port, inbox: await listInbox() }
  }

  /** A panel as Chrome reports it (window id -1) that registered its window over its port. */
  async function openPanel(documentId = 'panel-doc', windowId = 202) {
    env.contexts.push(sidePanelContext(documentId))
    const port = createFakePanelPort()
    env.connect(port)
    port.receive({ windowId, token: panelTokenFor(documentId) })
    await settleStorage()
    return port
  }

  it('binds the entry to the registered open panel and opens no window', async () => {
    env.local.data['nom-wallet-side-panel'] = true
    await openPanel()

    const { port, inbox } = await request(202)

    expect(inbox).toHaveLength(1)
    expect(inbox[0].panelWindowId).toBe(202)
    expect(inbox[0].windowId).toBeUndefined()
    expect(port.posted).toEqual([{ kind: 'accepted', id: 'ip:1' }])
    expect(env.chrome.windows.create).not.toHaveBeenCalled()
    expect(env.chrome.windows.update).not.toHaveBeenCalled()
  })

  it('keeps the panel entry unstamped by a later window open', async () => {
    env.local.data['nom-wallet-side-panel'] = true
    await openPanel()
    await request(202)
    const other = createFakePort(ORIGIN, 6, 0, 404)
    env.connect(other)
    other.receive({ ...connectRequest('ip:2') })
    await settleStorage()

    const { listInbox } = await import('@/sw/approval-inbox')
    const [panel, window] = await listInbox()
    expect([panel.id, panel.panelWindowId, panel.windowId]).toEqual(['ip:1', 202, undefined])
    expect([window.id, window.panelWindowId, window.windowId]).toEqual(['ip:2', undefined, 101])
  })

  it('rejects the request when the panel closes while the entry is being added', async () => {
    env.local.data['nom-wallet-side-panel'] = true
    await openPanel()
    env.chrome.runtime.getContexts.mockResolvedValueOnce([PANEL]).mockImplementation(async () => [])

    const { port, inbox } = await request(202)

    const { APPROVAL_CLOSED_ERROR } = await import('@/sw/approval-inbox')
    expect(inbox).toEqual([])
    expect(port.posted).toContainEqual({
      kind: 'outcome',
      id: 'ip:1',
      error: APPROVAL_CLOSED_ERROR,
    })
    expect(env.chrome.windows.create).not.toHaveBeenCalled()
  })

  it.each([
    ['no panel at all', async () => {}],
    [
      'an open panel that never registered',
      async () => {
        env.contexts.push(PANEL)
      },
    ],
    [
      'a registered panel that has closed',
      async () => {
        await openPanel()
        env.contexts.length = 0
      },
    ],
    [
      'a panel registered in another window',
      async () => {
        await openPanel('panel-doc', 303)
      },
    ],
    [
      'a lookup rejection',
      async () => {
        await openPanel()
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        env.chrome.runtime.getContexts.mockRejectedValue(new Error('no contexts'))
      },
    ],
  ])('opens the approval window with %s', async (_name, arrange) => {
    env.local.data['nom-wallet-side-panel'] = true
    await arrange()

    const { inbox } = await request(202)

    expect(inbox[0].windowId).toBe(101)
    expect(inbox[0].panelWindowId).toBeUndefined()
    expect(env.chrome.windows.create).toHaveBeenCalledOnce()
  })

  it('ignores a registration port from a tab', async () => {
    env.local.data['nom-wallet-side-panel'] = true
    env.contexts.push({
      contextType: 'TAB',
      frameId: 0,
      windowId: 202,
      tabId: 9,
      documentId: 'tab-doc',
    })
    const port = createFakePanelPort()
    port.sender.tab = { id: 9 }
    env.connect(port)
    port.receive({ windowId: 202, token: panelTokenFor('tab-doc') })
    await settleStorage()

    const { inbox } = await request(202)

    expect(inbox[0].windowId).toBe(101)
  })

  it('opens the approval window when the setting is off and never looks up contexts', async () => {
    env.local.data['nom-wallet-side-panel'] = false
    await openPanel()
    env.chrome.runtime.getContexts.mockClear()

    const { inbox } = await request(202)

    expect(inbox[0].windowId).toBe(101)
    expect(inbox[0].panelWindowId).toBeUndefined()
    expect(env.chrome.runtime.getContexts).not.toHaveBeenCalled()
  })
})

describe('router settings revoke', () => {
  it('revokes in the worker when the settings page asks', async () => {
    const { grant, isGranted } = await import('@/core/site-permissions')
    await grant(ORIGIN)
    const listener = env.chrome.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: { url: string },
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()

    const handled = listener(
      { channel: 'internal', kind: 'sites.revoke', origin: ORIGIN },
      { url: 'chrome-extension://wallet/index.html' },
      sendResponse
    )
    await settleStorage()

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
    expect(await isGranted(ORIGIN)).toBe(false)
  })

  it('ignores a revoke sent from a web page’s content script', async () => {
    const { grant, isGranted } = await import('@/core/site-permissions')
    await grant(ORIGIN)
    const listener = env.chrome.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: { url: string },
      sendResponse: (response: unknown) => void
    ) => boolean

    const handled = listener(
      { channel: 'internal', kind: 'sites.revoke', origin: ORIGIN },
      { url: 'https://evil.example/' },
      vi.fn()
    )
    await settleStorage()

    expect(handled).toBe(false)
    expect(await isGranted(ORIGIN)).toBe(true)
  })
})

describe('router approvals.rebind', () => {
  const OTHER = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

  type Listener = (
    message: unknown,
    sender: { url: string },
    sendResponse: (response: unknown) => void
  ) => boolean

  beforeEach(() => {
    env.local.data['nom-wallet-storage'] = {
      wallets: [
        {
          baseAddress: ACCOUNT,
          accounts: [
            { address: ACCOUNT, index: 0 },
            { address: OTHER, index: 1 },
          ],
        },
      ],
      activeWalletAddress: ACCOUNT,
      activeAccountAddress: ACCOUNT,
    }
  })

  async function queueConnect(): Promise<Listener> {
    const port = createFakePort(ORIGIN, 5)
    env.connect(port)
    port.receive(connectRequest('ip:1'))
    await settleStorage()
    return env.chrome.runtime.onMessage.addListener.mock.calls[0][0] as Listener
  }

  async function boundAccount(): Promise<string | undefined> {
    const { listInbox } = await import('@/sw/approval-inbox')
    return (await listInbox())[0]?.account
  }

  const rebind = (account: string) => ({
    channel: 'internal',
    kind: 'approvals.rebind',
    id: 'ip:1',
    account,
  })

  it('re-binds the entry for a message from an extension page', async () => {
    const listener = await queueConnect()
    const sendResponse = vi.fn()

    const handled = listener(
      rebind(OTHER),
      { url: 'chrome-extension://wallet/approve.html' },
      sendResponse
    )
    await settleStorage()

    expect(handled).toBe(true)
    expect(sendResponse).toHaveBeenCalledWith({ ok: true })
    expect(await boundAccount()).toBe(OTHER)
  })

  it('ignores the message from a web page’s content script', async () => {
    const listener = await queueConnect()
    const sendResponse = vi.fn()

    const handled = listener(rebind(OTHER), { url: 'https://evil.example/' }, sendResponse)
    await settleStorage()

    expect(handled).toBe(false)
    expect(sendResponse).not.toHaveBeenCalled()
    expect(await boundAccount()).toBe(ACCOUNT)
  })

  it('answers not ok for an address of no stored wallet', async () => {
    const listener = await queueConnect()
    const sendResponse = vi.fn()

    listener(rebind('z1stranger'), { url: 'chrome-extension://wallet/approve.html' }, sendResponse)
    await settleStorage()

    expect(sendResponse).toHaveBeenCalledWith({ ok: false })
    expect(await boundAccount()).toBe(ACCOUNT)
  })
})

describe('router read-only requests', () => {
  const PRIVATE_NODE = 'wss://node.private.example:35998/rpc?key=secret'

  async function readOnly(method: string): Promise<unknown> {
    const listener = env.chrome.runtime.onMessage.addListener.mock.calls[0][0] as (
      message: unknown,
      sender: { origin: string },
      sendResponse: (response: unknown) => void
    ) => boolean
    const sendResponse = vi.fn()
    listener({ channel: 'znn-provider', method }, { origin: ORIGIN }, sendResponse)
    await settleStorage()
    return sendResponse.mock.calls[0][0]
  }

  beforeEach(() => {
    env.local.data['nom-wallet-selected-node'] = PRIVATE_NODE
  })

  it('does not tell an origin that is not connected which node the wallet uses', async () => {
    const response = (await readOnly('znn_nodeUrl')) as Record<string, unknown>

    expect(response).toEqual({
      granted: false,
      error: { code: 4100, message: 'Connect to the wallet to read its node.' },
    })
    expect(JSON.stringify(response)).not.toContain('private.example')
  })

  it('gives a connected origin the node URL', async () => {
    const { grant } = await import('@/core/site-permissions')
    await grant(ORIGIN)

    expect(await readOnly('znn_nodeUrl')).toEqual({ granted: true, result: PRIVATE_NODE })
  })

  it('still answers the chain id for an origin that is not connected', async () => {
    expect(await readOnly('znn_chainId')).toEqual({ granted: false, result: 3 })
  })
})

describe('router message access', () => {
  type Listener = (
    message: unknown,
    sender: { url?: string; origin?: string },
    sendResponse: (response: unknown) => void
  ) => boolean

  const base = () => testAccount(TEST_ENTROPY, 0)
  const peer = () => testAccount(OTHER_ENTROPY, 0)

  const listener = () => env.chrome.runtime.onMessage.addListener.mock.calls[0][0] as Listener

  async function send(
    message: unknown,
    sender: { url?: string; origin?: string }
  ): Promise<unknown> {
    const sendResponse = vi.fn()
    listener()(message, sender, sendResponse)
    await settleStorage()
    return sendResponse.mock.calls[0]?.[0]
  }

  const decryptRequest = (params: unknown, origin = ORIGIN) =>
    send({ channel: 'znn-provider', method: 'znn_decryptMessages', params }, { origin })

  const fromExtension = { url: 'chrome-extension://wallet/index.html' }

  function validItems() {
    const envelope = sealMessage({
      ownSeed: peer().seed,
      ownPublicKey: peer().publicKey,
      counterpartyPublicKey: base().publicKey,
      content: { body: 'hello', replyTo: null },
    })
    return [
      {
        data: Buffer.from(envelope).toString('base64'),
        publicKey: Buffer.from(peer().publicKey).toString('hex'),
        outgoing: false,
      },
    ]
  }

  beforeEach(() => {
    env.local.data['nom-wallet-storage'] = walletStorage(TEST_ENTROPY, [0], 0)
    env.session.data['nom-wallet.key:' + base().address] = TEST_ENTROPY
    env.session.data['nom-wallet.lastActivityAt'] = Date.now()
  })

  async function connectAndGrantMessages() {
    const { grant, grantMessages } = await import('@/core/site-permissions')
    await grant(ORIGIN)
    await grantMessages(ORIGIN, base().address)
  }

  describe('znn_decryptMessages', () => {
    it('refuses an origin that is not connected with 4100', async () => {
      expect(await decryptRequest(validItems())).toEqual({
        granted: false,
        error: { code: 4100, message: 'Connect to the wallet to read messages.' },
      })
    })

    it('refuses a connected origin without a message grant with 4100', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)

      expect(await decryptRequest(validItems())).toEqual({
        granted: true,
        error: { code: 4100, message: 'Message access is not granted for this account.' },
      })
    })

    it('refuses malformed params with -32602', async () => {
      await connectAndGrantMessages()

      for (const params of [undefined, [], 'x', [{ data: 5 }], Array(51).fill(validItems()[0])]) {
        expect(await decryptRequest(params)).toMatchObject({
          granted: true,
          error: { code: -32602 },
        })
      }
    })

    it('answers a granted origin with the wallet unlocked', async () => {
      await connectAndGrantMessages()

      expect(await decryptRequest(validItems())).toEqual({
        granted: true,
        result: [{ ok: true, body: 'hello', replyTo: null }],
      })
    })

    it('refuses with 4900 when the wallet is locked', async () => {
      await connectAndGrantMessages()
      delete env.session.data['nom-wallet.key:' + base().address]

      expect(await decryptRequest(validItems())).toMatchObject({ error: { code: 4900 } })
    })

    it('never sends key material to the page', async () => {
      await connectAndGrantMessages()

      const response = JSON.stringify(await decryptRequest(validItems()))

      expect(response).not.toContain(TEST_ENTROPY)
      expect(response).not.toContain(Buffer.from(base().seed).toString('hex'))
    })

    it('does not answer a decrypt from an extension page sender without an origin', async () => {
      await connectAndGrantMessages()

      expect(
        await send(
          { channel: 'znn-provider', method: 'znn_decryptMessages', params: validItems() },
          {}
        )
      ).toMatchObject({ granted: false, error: { code: 4100 } })
    })
  })

  describe('znn_decryptInscriptions', () => {
    const NAMED = JSON.stringify({ v: 1, name: 'Sealed' })

    const inscriptionRequest = (params: unknown, origin = ORIGIN) =>
      send({ channel: 'znn-provider', method: 'znn_decryptInscriptions', params }, { origin })

    const sealedItems = async () => [{ payload: await sodiumSealPayload(NAMED, base().publicKey) }]

    it('refuses an origin that is not connected with 4100', async () => {
      expect(await inscriptionRequest(await sealedItems())).toEqual({
        granted: false,
        error: { code: 4100, message: 'Connect to the wallet to read inscriptions.' },
      })
    })

    it('refuses a connected origin without a message grant with 4100', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)

      expect(await inscriptionRequest(await sealedItems())).toEqual({
        granted: true,
        error: { code: 4100, message: 'Message access is not granted for this account.' },
      })
    })

    it('refuses malformed params with -32602', async () => {
      await connectAndGrantMessages()
      const item = (await sealedItems())[0]

      for (const params of [undefined, [], 'x', [{ payload: 5 }], Array(51).fill(item)]) {
        expect(await inscriptionRequest(params)).toMatchObject({
          granted: true,
          error: { code: -32602 },
        })
      }
    })

    it('answers a granted origin with the wallet unlocked', async () => {
      await connectAndGrantMessages()

      expect(await inscriptionRequest(await sealedItems())).toEqual({
        granted: true,
        result: [{ ok: true, json: NAMED }],
      })
    })

    it('answers unreadable per item with no other detail', async () => {
      await connectAndGrantMessages()
      const other = await sodiumSealPayload(NAMED, peer().publicKey)

      expect(await inscriptionRequest([{ payload: other }, { payload: 'AAAA' }])).toEqual({
        granted: true,
        result: [
          { ok: false, reason: 'unreadable' },
          { ok: false, reason: 'unreadable' },
        ],
      })
    })

    it('refuses with 4900 when the wallet is locked', async () => {
      await connectAndGrantMessages()
      delete env.session.data['nom-wallet.key:' + base().address]

      expect(await inscriptionRequest(await sealedItems())).toMatchObject({
        error: { code: 4900 },
      })
    })

    it('never sends key material to the page', async () => {
      await connectAndGrantMessages()

      const response = JSON.stringify(await inscriptionRequest(await sealedItems()))

      expect(response).not.toContain(TEST_ENTROPY)
      expect(response).not.toContain(Buffer.from(base().seed).toString('hex'))
    })

    it('does not answer a request from an extension page sender without an origin', async () => {
      await connectAndGrantMessages()

      expect(
        await send(
          {
            channel: 'znn-provider',
            method: 'znn_decryptInscriptions',
            params: await sealedItems(),
          },
          {}
        )
      ).toMatchObject({ granted: false, error: { code: 4100 } })
    })
  })

  describe('secure origins', () => {
    const INSECURE = [
      'http://example.com',
      'http://192.168.1.5',
      'null',
      'http://localhost.evil.com',
    ]
    const SECURE = [
      'http://zenonhub.localhost',
      'http://devnet.zenonhub.localhost',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
      'https://zenonhub.io',
    ]

    async function grantFor(origin: string) {
      const { grant, grantMessages } = await import('@/core/site-permissions')
      await grant(origin)
      await grantMessages(origin, base().address)
    }

    async function requestAccess(origin: string) {
      const port = createFakePort(origin, 5)
      env.connect(port)
      port.receive({ kind: 'request', id: 'ip:7', method: 'znn_requestMessageAccess' })
      await settleStorage()
      return port.posted
    }

    it.each(INSECURE)('refuses decrypt from %s even with a stored grant', async (origin) => {
      await grantFor(origin)

      expect(await decryptRequest(validItems(), origin)).toEqual({
        granted: true,
        error: { code: 4100, message: 'Message access needs an https page or a localhost page.' },
      })
    })

    it.each(INSECURE)(
      'refuses inscription decrypt from %s even with a stored grant',
      async (origin) => {
        await grantFor(origin)

        expect(
          await send(
            {
              channel: 'znn-provider',
              method: 'znn_decryptInscriptions',
              params: [{ payload: 'AAAA' }],
            },
            { origin }
          )
        ).toEqual({
          granted: true,
          error: { code: 4100, message: 'Message access needs an https page or a localhost page.' },
        })
      }
    )

    it.each(SECURE)('answers decrypt from %s', async (origin) => {
      await grantFor(origin)

      expect(await decryptRequest(validItems(), origin)).toHaveProperty('result')
    })

    it.each(INSECURE)(
      'refuses a message access request from %s before queueing it',
      async (origin) => {
        const { grant } = await import('@/core/site-permissions')
        await grant(origin)

        expect(await requestAccess(origin)).toEqual([
          {
            kind: 'outcome',
            id: 'ip:7',
            error: {
              code: 4100,
              message: 'Message access needs an https page or a localhost page.',
            },
          },
        ])
        const { listInbox } = await import('@/sw/approval-inbox')
        expect(await listInbox()).toEqual([])
      }
    )

    it.each(SECURE)('queues a message access request from %s', async (origin) => {
      const { grant } = await import('@/core/site-permissions')
      await grant(origin)

      expect(await requestAccess(origin)).toContainEqual({ kind: 'accepted', id: 'ip:7' })
    })
  })

  describe('decrypt queue', () => {
    it('runs one decrypt at a time per origin and keeps other origins moving', async () => {
      vi.resetModules()
      env = installFakeChrome()
      const live = new Map<string, number>()
      const peak = new Map<string, number>()
      const gates: (() => void)[] = []
      vi.doMock('@/sw/message-decrypt', () => ({
        decryptForOrigin: async (origin: string) => {
          live.set(origin, (live.get(origin) ?? 0) + 1)
          peak.set(origin, Math.max(peak.get(origin) ?? 0, live.get(origin) ?? 0))
          await new Promise<void>((resolve) => gates.push(resolve))
          live.set(origin, (live.get(origin) ?? 1) - 1)
          return { result: [] }
        },
      }))
      await import('@/sw/router')
      const { grant } = await import('@/core/site-permissions')
      const other = 'https://other.example'
      await grant(ORIGIN)
      await grant(other)
      const send = (origin: string) => {
        const sendResponse = vi.fn()
        listener()(
          { channel: 'znn-provider', method: 'znn_decryptMessages', params: validItems() },
          { origin },
          sendResponse
        )
        return sendResponse
      }

      const answers = [send(ORIGIN), send(ORIGIN), send(ORIGIN), send(other)]
      await settleStorage()

      // The first call of each origin is in flight; the rest of ORIGIN wait.
      expect(gates).toHaveLength(2)
      while (answers.some((answer) => answer.mock.calls.length === 0)) {
        gates.shift()?.()
        await settleStorage()
      }
      expect(peak.get(ORIGIN)).toBe(1)
      expect(peak.get(other)).toBe(1)
      for (const answer of answers)
        expect(answer).toHaveBeenCalledWith({ granted: true, result: [] })
      vi.doUnmock('@/sw/message-decrypt')
    })
  })

  describe('decrypt queue across both methods', () => {
    it('runs a message decrypt and an inscription decrypt of one origin one at a time', async () => {
      vi.resetModules()
      env = installFakeChrome()
      let live = 0
      let peak = 0
      const gates: (() => void)[] = []
      const slow = async () => {
        live++
        peak = Math.max(peak, live)
        await new Promise<void>((resolve) => gates.push(resolve))
        live--
        return { result: [] }
      }
      vi.doMock('@/sw/message-decrypt', () => ({
        decryptForOrigin: slow,
        decryptInscriptionsForOrigin: slow,
      }))
      await import('@/sw/router')
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)
      const fire = (method: string, params: unknown) => {
        const sendResponse = vi.fn()
        listener()({ channel: 'znn-provider', method, params }, { origin: ORIGIN }, sendResponse)
        return sendResponse
      }

      const answers = [
        fire('znn_decryptMessages', validItems()),
        fire('znn_decryptInscriptions', [{ payload: 'AAAA' }]),
        fire('znn_decryptMessages', validItems()),
      ]
      await settleStorage()

      expect(gates).toHaveLength(1)
      while (answers.some((answer) => answer.mock.calls.length === 0)) {
        gates.shift()?.()
        await settleStorage()
      }
      expect(peak).toBe(1)
      vi.doUnmock('@/sw/message-decrypt')
    })
  })

  describe('znn_sendEncryptedMessage', () => {
    const sendParams = (overrides: Record<string, unknown> = {}) => ({
      to: peer().address,
      publicKey: Buffer.from(peer().publicKey).toString('hex'),
      body: 'Hello B',
      ...overrides,
    })

    async function sendMessage(params: unknown, origin = ORIGIN) {
      const port = createFakePort(origin, 5)
      env.connect(port)
      port.receive({ kind: 'request', id: 'ip:8', method: 'znn_sendEncryptedMessage', params })
      await settleStorage()
      return port.posted
    }

    const outcomeError = (posted: unknown[]) =>
      (posted as { kind: string; error?: { code: number; message: string } }[]).find(
        (m) => m.kind === 'outcome'
      )?.error

    async function connect(origin = ORIGIN) {
      const { grant } = await import('@/core/site-permissions')
      await grant(origin)
    }

    it('gives an origin that is not connected 4100 and opens no window', async () => {
      expect(outcomeError(await sendMessage(sendParams()))).toEqual({
        code: 4100,
        message: 'Origin is not connected.',
      })
      expect(env.chrome.windows.create).not.toHaveBeenCalled()
    })

    it.each(['http://example.com', 'null'])('refuses %s before queueing', async (origin) => {
      await connect(origin)

      expect(outcomeError(await sendMessage(sendParams(), origin))).toMatchObject({ code: 4100 })
      expect(env.chrome.windows.create).not.toHaveBeenCalled()
      const { listInbox } = await import('@/sw/approval-inbox')
      expect(await listInbox()).toEqual([])
    })

    it('queues a request from a localhost page', async () => {
      await connect('http://devnet.zenonhub.localhost')

      const posted = await sendMessage(sendParams(), 'http://devnet.zenonhub.localhost')

      expect(posted).toContainEqual({ kind: 'accepted', id: 'ip:8' })
      const { listInbox } = await import('@/sw/approval-inbox')
      expect(await listInbox()).toEqual([
        expect.objectContaining({ id: 'ip:8', method: 'znn_sendEncryptedMessage' }),
      ])
    })

    it.each([
      ['a malformed body', sendParams({ body: '' })],
      ['a missing recipient', sendParams({ to: undefined })],
      ['params that are not an object', 'x'],
      ['a body over the limit', sendParams({ body: 'a'.repeat(20_000) })],
    ])('refuses %s with -32602 and opens no window', async (_name, params) => {
      await connect()

      expect(outcomeError(await sendMessage(params))).toMatchObject({ code: -32602 })
      expect(env.chrome.windows.create).not.toHaveBeenCalled()
      const { listInbox } = await import('@/sw/approval-inbox')
      expect(await listInbox()).toEqual([])
    })

    it('stores only the validated fields of the request in the inbox', async () => {
      await connect()
      const huge = 'x'.repeat(2_000_000)

      await sendMessage({
        ...sendParams({ replyTo: 'AB'.repeat(32) }),
        padding: huge,
        nested: { huge },
      })

      const { listInbox } = await import('@/sw/approval-inbox')
      const [stored] = await listInbox()
      expect(stored.params).toEqual({
        to: peer().address,
        publicKey: Buffer.from(peer().publicKey).toString('hex'),
        body: 'Hello B',
        replyTo: 'ab'.repeat(32),
      })
      expect(JSON.stringify(env.session.data).length).toBeLessThan(100_000)
      expect(encryptedMessageParamsProblem(stored.params)).toBeNull()
    })

    it('drops a subject field from the stored params', async () => {
      await connect()

      await sendMessage(sendParams({ subject: 'Hi' }))

      const { listInbox } = await import('@/sw/approval-inbox')
      const [stored] = await listInbox()
      expect(stored.params).not.toHaveProperty('subject')
    })

    it('stores no reply field the request did not carry', async () => {
      await connect()

      await sendMessage({
        to: peer().address,
        publicKey: Buffer.from(peer().publicKey).toString('hex'),
        body: 'x',
      })

      const { listInbox } = await import('@/sw/approval-inbox')
      const [stored] = await listInbox()
      expect(stored.params).toEqual({
        to: peer().address,
        publicKey: Buffer.from(peer().publicKey).toString('hex'),
        body: 'x',
      })
      expect(encryptedMessageParamsProblem(stored.params)).toBeNull()
    })

    it('refuses a public key that does not belong to the recipient before any screen', async () => {
      await connect()

      const error = outcomeError(
        await sendMessage(sendParams({ publicKey: Buffer.from(base().publicKey).toString('hex') }))
      )

      expect(error).toEqual({
        code: -32602,
        message: 'The public key does not belong to the recipient.',
      })
      expect(env.chrome.windows.create).not.toHaveBeenCalled()
    })
  })

  describe('znn_requestMessageAccess', () => {
    async function queue(origin = ORIGIN) {
      const port = createFakePort(origin, 5)
      env.connect(port)
      port.receive({ kind: 'request', id: 'ip:9', method: 'znn_requestMessageAccess' })
      await settleStorage()
      return port
    }

    const settle = (message: Record<string, unknown>) =>
      send({ channel: 'internal', kind: 'approvals.settle', id: 'ip:9', ...message }, fromExtension)

    const canRead = async () => {
      const { canReadMessages } = await import('@/core/site-permissions')
      return canReadMessages(ORIGIN, base().address)
    }

    it('refuses an origin that is not connected', async () => {
      const port = await queue()

      expect(port.posted).toContainEqual(
        expect.objectContaining({
          kind: 'outcome',
          error: { code: 4100, message: 'Origin is not connected.' },
        })
      )
    })

    it('queues a request with no params for a connected origin', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)

      await queue()

      const { listInbox } = await import('@/sw/approval-inbox')
      expect(await listInbox()).toEqual([
        expect.objectContaining({
          id: 'ip:9',
          method: 'znn_requestMessageAccess',
          account: base().address,
        }),
      ])
    })

    it('grants the bound account when the user approves', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)
      const port = await queue()

      await settle({ result: base().address })

      expect(await canRead()).toBe(true)
      expect(port.posted).toContainEqual(
        expect.objectContaining({ kind: 'outcome', id: 'ip:9', result: base().address })
      )
    })

    it('grants nothing when the user rejects', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)
      await queue()

      await settle({ error: { code: 4001, message: 'User rejected the request.' } })

      expect(await canRead()).toBe(false)
    })

    it('grants nothing for a settle from a web page', async () => {
      const { grant } = await import('@/core/site-permissions')
      await grant(ORIGIN)
      await queue()

      await send(
        { channel: 'internal', kind: 'approvals.settle', id: 'ip:9', result: base().address },
        { url: 'https://evil.example/' }
      )

      expect(await canRead()).toBe(false)
    })
  })

  describe('revoking', () => {
    const revoke = (extra: Record<string, unknown>) =>
      send({ channel: 'internal', kind: 'sites.revoke', ...extra }, fromExtension)

    it('keeps the site connected when only messages are revoked', async () => {
      await connectAndGrantMessages()
      const { isGranted, canReadMessages } = await import('@/core/site-permissions')

      await revoke({ origin: ORIGIN, messagesOnly: true })

      expect(await isGranted(ORIGIN)).toBe(true)
      expect(await canReadMessages(ORIGIN, base().address)).toBe(false)
      expect(await decryptRequest(validItems())).toMatchObject({ error: { code: 4100 } })
    })

    it('does not disconnect the live ports when only messages are revoked', async () => {
      await connectAndGrantMessages()
      const port = createFakePort(ORIGIN, 5)
      const disconnect = vi.spyOn(port, 'disconnect')
      env.connect(port)

      await revoke({ origin: ORIGIN, messagesOnly: true })

      expect(disconnect).not.toHaveBeenCalled()

      await revoke({ origin: ORIGIN })

      expect(disconnect).toHaveBeenCalled()
    })

    it('removes the grant with the site on a full revoke', async () => {
      await connectAndGrantMessages()

      await revoke({ origin: ORIGIN })

      expect(await decryptRequest(validItems())).toMatchObject({ granted: false })
      const { list } = await import('@/core/site-permissions')
      expect(await list()).toEqual([])
    })

    it('removes every grant on revoke all', async () => {
      await connectAndGrantMessages()

      await revoke({})

      expect(await decryptRequest(validItems())).toMatchObject({ granted: false })
    })

    it('removes the grant on znn_disconnect', async () => {
      await connectAndGrantMessages()

      await send({ channel: 'znn-provider', method: 'znn_disconnect' }, { origin: ORIGIN })

      expect(await decryptRequest(validItems())).toMatchObject({ granted: false })
      await (await import('@/core/site-permissions')).grant(ORIGIN)
      expect(await decryptRequest(validItems())).toMatchObject({
        error: { code: 4100, message: 'Message access is not granted for this account.' },
      })
    })

    it('ignores a messages-only revoke from a web page', async () => {
      await connectAndGrantMessages()

      await send(
        { channel: 'internal', kind: 'sites.revoke', origin: ORIGIN, messagesOnly: true },
        { url: 'https://evil.example/' }
      )

      expect(await decryptRequest(validItems())).toHaveProperty('granted', true)
      expect(await decryptRequest(validItems())).toHaveProperty('result')
    })
  })
})

describe('router inbox params', () => {
  const peerAccount = testAccount(OTHER_ENTROPY, 0)
  const ZNN = 'zts1znnxxxxxxxxxxxxx9z4ulx'
  const HUGE = 'x'.repeat(2_000_000)

  async function stored(method: string, params: unknown, origin = ORIGIN) {
    const { grant } = await import('@/core/site-permissions')
    await grant(origin)
    const port = createFakePort(origin, 5)
    env.connect(port)
    port.receive({ kind: 'request', id: 'ip:p', method, params })
    await settleStorage()
    const { listInbox } = await import('@/sw/approval-inbox')
    const [entry] = await listInbox()
    expect(entry?.id).toBe('ip:p')
    expect(JSON.stringify(env.session.data).length).toBeLessThan(100_000)
    return entry.params
  }

  it('znn_connect keeps no params', async () => {
    expect(await stored('znn_connect', { padding: HUGE })).toBeUndefined()
  })

  it('znn_requestMessageAccess keeps no params', async () => {
    expect(await stored('znn_requestMessageAccess', { padding: HUGE })).toBeUndefined()
  })

  it('znn_sign keeps the message, which is already bounded', async () => {
    expect(await stored('znn_sign', 'sign this')).toBe('sign this')
  })

  it('znn_sendTransaction keeps only to, tokenStandard and amount', async () => {
    const params = { to: peerAccount.address, tokenStandard: ZNN, amount: '100' }

    const kept = await stored('znn_sendTransaction', { ...params, padding: HUGE, memo: { HUGE } })

    expect(kept).toEqual(params)
    expect(sendTransactionParamsProblem(kept)).toBeNull()
  })

  it('znn_signAndSendBlock keeps only the send fields of a send block', async () => {
    const block = {
      blockType: 2,
      toAddress: peerAccount.address,
      tokenStandard: ZNN,
      amount: '100',
      data: 'AAAA',
    }

    const kept = await stored('znn_signAndSendBlock', {
      ...block,
      padding: HUGE,
      fromBlockHash: HUGE,
      chainIdentifier: 99,
    })

    expect(kept).toEqual(block)
    expect(accountBlockProblem(kept)).toBeNull()
  })

  it('znn_signAndSendBlock keeps only the hash of a receive block', async () => {
    const block = { blockType: 3, fromBlockHash: 'ab'.repeat(32) }

    const kept = await stored('znn_signAndSendBlock', {
      ...block,
      padding: HUGE,
      toAddress: peerAccount.address,
    })

    expect(kept).toEqual(block)
    expect(accountBlockProblem(kept)).toBeNull()
  })

  it('znn_signAndSendBlock leaves out data a send block did not carry', async () => {
    const block = { blockType: 2, toAddress: peerAccount.address, tokenStandard: ZNN, amount: 5 }

    expect(await stored('znn_signAndSendBlock', { ...block, padding: HUGE })).toEqual(block)
  })

  it('refuses a fourth pending request from one origin and still queues another origin', async () => {
    const { grant } = await import('@/core/site-permissions')
    await grant(ORIGIN)
    await grant('https://other.example')
    const ask = async (origin: string, id: string) => {
      const port = createFakePort(origin, origin === ORIGIN ? 5 : 6)
      env.connect(port)
      port.receive({ kind: 'request', id, method: 'znn_connect' })
      await settleStorage()
      return port.posted
    }

    for (const id of ['ip:1', 'ip:2', 'ip:3']) {
      expect(await ask(ORIGIN, id)).toContainEqual({ kind: 'accepted', id })
    }
    const refused = await ask(ORIGIN, 'ip:4')
    const other = await ask('https://other.example', 'ip:5')

    expect(refused).toEqual([
      {
        kind: 'outcome',
        id: 'ip:4',
        error: { code: -32005, message: 'Too many pending requests.' },
      },
    ])
    expect(other).toContainEqual({ kind: 'accepted', id: 'ip:5' })
  })
  it('caps one tab at three pending requests across a page and two cross-origin iframes', async () => {
    const { grant } = await import('@/core/site-permissions')
    const frames = [
      { origin: ORIGIN, frameId: 0 },
      { origin: 'https://ads.example', frameId: 1 },
      { origin: 'https://widget.example', frameId: 2 },
    ]
    for (const { origin } of frames) await grant(origin)
    const ask = async (origin: string, frameId: number, id: string, tabId = 5) => {
      const port = createFakePort(origin, tabId, frameId)
      env.connect(port)
      port.receive({ kind: 'request', id, method: 'znn_connect' })
      await settleStorage()
      return port.posted
    }

    expect(await ask(frames[1].origin, 1, 'ip:1')).toContainEqual({ kind: 'accepted', id: 'ip:1' })
    expect(await ask(frames[1].origin, 1, 'ip:2')).toContainEqual({ kind: 'accepted', id: 'ip:2' })
    expect(await ask(frames[2].origin, 2, 'ip:3')).toContainEqual({ kind: 'accepted', id: 'ip:3' })

    // The top page has no request of its own, but its tab is at the cap.
    const refused = await ask(frames[0].origin, 0, 'ip:4')
    expect(refused).toEqual([
      {
        kind: 'outcome',
        id: 'ip:4',
        error: { code: -32005, message: 'Too many pending requests.' },
      },
    ])
    expect(await ask(frames[0].origin, 0, 'ip:5', 9)).toContainEqual({
      kind: 'accepted',
      id: 'ip:5',
    })
  })

  it('bounds the stored tab title and favicon URL', async () => {
    const { grant } = await import('@/core/site-permissions')
    await grant(ORIGIN)
    const ask = async (id: string, title: string, favIconUrl: string, tabId: number) => {
      const port = createFakePort(ORIGIN, tabId)
      port.sender.tab.title = title
      ;(port.sender.tab as { favIconUrl?: string }).favIconUrl = favIconUrl
      env.connect(port)
      port.receive({ kind: 'request', id, method: 'znn_connect' })
      await settleStorage()
    }
    const tooLong = 'https://dapp.example/' + 'i'.repeat(2100)
    const fine = 'https://dapp.example/icon.png'

    await ask('ip:1', 't'.repeat(1_000_000), tooLong, 1)
    await ask('ip:2', 'My dApp', fine, 2)

    const { listInbox } = await import('@/sw/approval-inbox')
    const [long, normal] = await listInbox()
    expect(long.title).toBe('t'.repeat(200))
    expect(long.favicon).toBeUndefined()
    expect(normal).toMatchObject({ title: 'My dApp', favicon: fine })
    expect(JSON.stringify(env.session.data).length).toBeLessThan(10_000)
  })
})

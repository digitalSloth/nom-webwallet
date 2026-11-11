import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakePort, installFakeChrome, settleStorage } from '@/test/fake-chrome'

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

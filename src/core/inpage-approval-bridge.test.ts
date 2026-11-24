import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KeyStore, PLASMA_ADDRESS } from 'znn-typescript-sdk'

import { SESSION_KEY_PENDING_REQUESTS } from '@/config'
import { envelopeLength } from '@/core/message-envelope'
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
    windowId: 202,
    ...overrides,
  }
}

let env: ReturnType<typeof installFakeChrome>
let approvals: typeof import('@/core/dapp-approvals')

beforeEach(async () => {
  vi.resetModules()
  env = installFakeChrome()
  env.session.data[SESSION_KEY_PENDING_REQUESTS] = [
    entry('ip:connect'),
    entry('ip:sign', { method: 'znn_sign', params: 'hello' }),
    entry('ip:messages', { method: 'znn_requestMessageAccess' }),
  ]
  approvals = await import('@/core/dapp-approvals')
  const bridge = await import('@/core/inpage-approval-bridge')
  bridge.startInboxBridge({ kind: 'window' })
  await settleStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inbox bridge rebind handler', () => {
  it('queues both entries claimed by this window', () => {
    expect(approvals.listApprovals().map((a) => a.id)).toEqual([
      'ip:connect',
      'ip:sign',
      'ip:messages',
    ])
  })

  it('gives a connect a rebind that posts the internal message and resolves true on ok', async () => {
    env.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: true })

    const rebind = approvals.getHandlers('ip:connect')?.rebind
    expect(rebind).toBeTypeOf('function')
    expect(await rebind?.('z1other')).toBe(true)

    expect(env.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      channel: 'internal',
      kind: 'approvals.rebind',
      id: 'ip:connect',
      account: 'z1other',
    })
  })

  it('resolves false when the worker answers not ok', async () => {
    env.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: false })

    expect(await approvals.getHandlers('ip:connect')?.rebind?.('z1other')).toBe(false)
  })

  it('resolves false when the worker does not answer', async () => {
    env.chrome.runtime.sendMessage.mockResolvedValueOnce(undefined)

    expect(await approvals.getHandlers('ip:connect')?.rebind?.('z1other')).toBe(false)
  })

  it('resolves false for an answer that is not exactly ok: true', async () => {
    env.chrome.runtime.sendMessage.mockResolvedValueOnce({ ok: 'yes' })

    expect(await approvals.getHandlers('ip:connect')?.rebind?.('z1other')).toBe(false)
  })

  it('gives a sign entry no rebind', () => {
    expect(approvals.getHandlers('ip:sign')).toBeDefined()
    expect(approvals.getHandlers('ip:sign')?.rebind).toBeUndefined()
  })
})

describe('inbox bridge message access', () => {
  it('turns a znn_requestMessageAccess entry into a messageAccess approval', () => {
    const queued = approvals.listApprovals().find((a) => a.id === 'ip:messages')

    expect(queued?.action).toEqual({ kind: 'messageAccess' })
    expect(queued?.account).toBe(ACCOUNT)
  })

  it('settles with the account address and no rebind', async () => {
    const handlers = approvals.getHandlers('ip:messages')

    await handlers?.resolve({ kind: 'messageAccess', address: ACCOUNT })

    expect(handlers?.rebind).toBeUndefined()
    expect(env.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      channel: 'internal',
      kind: 'approvals.settle',
      id: 'ip:messages',
      result: ACCOUNT,
    })
  })

  it('settles a rejection with its error and no result', async () => {
    await approvals.getHandlers('ip:messages')?.reject({ reason: 'userRejected' })

    expect(env.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      channel: 'internal',
      kind: 'approvals.settle',
      id: 'ip:messages',
      error: { code: 4001, message: 'User rejected the request.' },
    })
  })
})

describe('inbox bridge encrypted message', () => {
  const recipient = KeyStore.fromEntropy(
    'f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100'
  ).getKeyPair(0)
  const other = KeyStore.fromEntropy(
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
  ).getKeyPair(0)
  const params = (overrides: Record<string, unknown> = {}) => ({
    to: recipient.address.toString(),
    publicKey: recipient.publicKey.toString('hex'),
    body: 'Hello B',
    ...overrides,
  })

  async function claim(entries: InboxEntry[]) {
    vi.resetModules()
    env = installFakeChrome()
    env.session.data[SESSION_KEY_PENDING_REQUESTS] = entries
    approvals = await import('@/core/dapp-approvals')
    const bridge = await import('@/core/inpage-approval-bridge')
    bridge.startInboxBridge({ kind: 'window' })
    await settleStorage()
  }

  const send = (id: string, p: unknown) =>
    entry(id, { method: 'znn_sendEncryptedMessage', params: p })

  const settled = (id: string) =>
    env.chrome.runtime.sendMessage.mock.calls
      .map(([message]) => message as { id?: string; error?: { code: number; message: string } })
      .find((message) => message.id === id)

  it('enqueues a sendMessage approval whose size equals the sealed envelope size', async () => {
    await claim([send('ip:good', params({ replyTo: 'AB'.repeat(32) }))])

    const [queued] = approvals.listApprovals()
    const content = { body: 'Hello B', replyTo: 'ab'.repeat(32) }
    expect(queued.action).toEqual({
      kind: 'sendMessage',
      to: recipient.address.toString(),
      recipientPublicKey: recipient.publicKey.toString('hex'),
      content,
      envelopeBytes: envelopeLength(content),
    })
  })

  it('settles invalidParams and enqueues nothing when the public key is another address', async () => {
    await claim([send('ip:bad', params({ publicKey: other.publicKey.toString('hex') }))])

    expect(approvals.listApprovals()).toEqual([])
    expect(settled('ip:bad')?.error).toEqual({
      code: -32602,
      message: 'The public key does not belong to the recipient.',
    })
  })

  it('refuses an embedded contract recipient the same way', async () => {
    const contract = PLASMA_ADDRESS.toString()
    await claim([send('ip:contract', params({ to: contract }))])

    expect(approvals.listApprovals()).toEqual([])
    expect(settled('ip:contract')?.error).toEqual({
      code: -32602,
      message: 'The public key does not belong to the recipient.',
    })
  })

  it('settles invalidParams for malformed params and enqueues nothing', async () => {
    await claim([send('ip:empty', params({ body: '' })), send('ip:odd', 'x')])

    expect(approvals.listApprovals()).toEqual([])
    expect(settled('ip:empty')?.error?.code).toBe(-32602)
    expect(settled('ip:odd')?.error?.code).toBe(-32602)
  })

  it('settles with the published block JSON', async () => {
    await claim([send('ip:good', params())])
    const block = { toJson: () => ({ hash: 'abc' }), hash: { toString: () => 'abc' } }

    await approvals.getHandlers('ip:good')?.resolve({ kind: 'sendBlock', block: block as never })

    expect(settled('ip:good')).toMatchObject({ result: { hash: 'abc' } })
  })
})

describe('watchPanelVisibility', () => {
  it('re-sends the hello on the live port when the document becomes visible', async () => {
    const { watchPanelVisibility } = await import('@/core/inpage-approval-bridge')
    vi.stubGlobal('location', { search: '?panel=tok' })
    let listener: () => void = () => {}
    const doc = {
      visibilityState: 'hidden' as DocumentVisibilityState,
      addEventListener: (_type: string, fn: () => void) => (listener = fn),
    }
    const port = { postMessage: vi.fn() }
    watchPanelVisibility(doc, () => port, 7)

    listener()
    expect(port.postMessage).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    listener()
    expect(port.postMessage).toHaveBeenCalledWith({ windowId: 7, token: 'tok' })
    vi.unstubAllGlobals()
  })

  it('sends nothing without a port or a token', async () => {
    const { watchPanelVisibility } = await import('@/core/inpage-approval-bridge')
    let listener: () => void = () => {}
    const doc = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: (_type: string, fn: () => void) => (listener = fn),
    }
    const port = { postMessage: vi.fn() }
    vi.stubGlobal('location', { search: '' })
    watchPanelVisibility(doc, () => port, 7)
    listener()
    vi.stubGlobal('location', { search: '?panel=tok' })
    watchPanelVisibility(doc, () => null, 7)
    listener()
    expect(port.postMessage).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

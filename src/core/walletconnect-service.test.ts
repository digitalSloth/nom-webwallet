import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IWalletConnectClient, WalletConnectClientHandlers } from '@/core/walletconnect-client'

const ACCOUNT = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'
const stored = { chainId: 1 }
const toastError = vi.fn()
const mocks = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
const META_KEY = 'nom-wallet-wc-session-meta'

vi.mock('@/core/storage/storage-service', () => ({
  storageService: {
    get: async (key: string) => (mocks.store.has(key) ? mocks.store.get(key) : null),
    set: async (key: string, value: unknown) => {
      mocks.store.set(key, structuredClone(value))
    },
  },
}))

vi.mock('vue-sonner', () => ({ toast: { error: toastError } }))
vi.mock('@/core/wallet-service', () => ({
  WalletService: { getInstance: () => ({ getActiveAccount: async () => ACCOUNT }) },
}))
vi.mock('@/core/zenon-service', () => ({
  readPersistedChainId: async () => stored.chainId,
  ZenonService: { getInstance: () => ({ getNodeUrl: () => 'wss://node.example:35998' }) },
}))

type Service = typeof import('@/core/walletconnect-service')
type Approvals = typeof import('@/core/dapp-approvals')

let service: InstanceType<Service['WalletConnectService']>
let approvals: Approvals
let client: IWalletConnectClient & Record<keyof IWalletConnectClient, ReturnType<typeof vi.fn>>
let handlers: WalletConnectClientHandlers

function verified(): { verified: Record<string, unknown> } {
  return { verified: { origin: 'https://dapp.example', validation: 'VALID', verifyUrl: '' } }
}

function session(topic: string, chain = 'zenon:1') {
  return {
    topic,
    peer: { metadata: { name: 'dApp', url: 'https://dapp.example', icons: [] } },
    namespaces: { zenon: { chains: [chain], methods: [], events: [], accounts: [] } },
  }
}

function signRequest(topic: string, rpcId: number, overrides: Record<string, unknown> = {}) {
  return {
    topic,
    id: rpcId,
    verifyContext: verified(),
    params: {
      chainId: 'zenon:1',
      request: { method: 'znn_sign', params: 'hello', expiryTimestamp: 1_900_000_000 },
      ...overrides,
    },
  } as unknown as Parameters<WalletConnectClientHandlers['onRequest']>[0]
}

function proposal(overrides: Record<string, unknown> = {}, verifyContext: unknown = verified()) {
  return {
    id: 77,
    verifyContext,
    params: {
      expiryTimestamp: 1_900_000_300,
      proposer: { metadata: { name: 'dApp', url: 'https://dapp.example', icons: [] } },
      requiredNamespaces: {
        zenon: { chains: ['zenon:1'], methods: ['znn_sign'], events: ['addressChange'] },
      },
      ...overrides,
    },
  } as unknown as Parameters<WalletConnectClientHandlers['onProposal']>[0]
}

/** Lets the un-awaited storage work run to completion. */
async function settleMeta(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Lets the un-awaited handler promises run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(async () => {
  mocks.store.clear()
  vi.resetModules()
  vi.stubGlobal('__IS_EXTENSION__', false)
  stored.chainId = 1
  client = {
    init: vi.fn(async (h: WalletConnectClientHandlers) => {
      handlers = h
    }),
    pair: vi.fn(),
    listSessions: vi.fn(() => [session('t'), session('u')]),
    approveProposal: vi.fn(async () => 'topic-new'),
    rejectProposal: vi.fn(async () => {}),
    respond: vi.fn(async () => {}),
    respondError: vi.fn(async () => {}),
    updateSessionAccounts: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  } as unknown as typeof client
  const module = await import('@/core/walletconnect-service')
  approvals = await import('@/core/dapp-approvals')
  service = module.WalletConnectService.getInstance()
  await service.initialize(client)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('WalletConnect requests', () => {
  it('queues a request with its expiry, account, chain and verification', async () => {
    handlers.onRequest(signRequest('t', 1))
    await flush()

    expect(approvals.listApprovals()).toEqual([
      expect.objectContaining({
        id: 'wc:t:1',
        expiresAt: 1_900_000_000_000,
        account: ACCOUNT,
        chainId: 1,
        verification: 'valid',
      }),
    ])
  })

  it('refuses a request made for a chain other than the wallet’s', async () => {
    stored.chainId = 3
    handlers.onRequest(signRequest('t', 1))
    await flush()

    expect(client.respondError).toHaveBeenCalledWith('t', 1, {
      kind: 'protocol',
      rejection: 'UNSUPPORTED_CHAINS',
    })
    expect(approvals.listApprovals()).toEqual([])
  })

  it('rejects a request from a peer flagged as a scam without showing it', async () => {
    const request = signRequest('t', 1)
    request.verifyContext.verified.isScam = true
    handlers.onRequest(request)
    await flush()

    expect(client.respondError).toHaveBeenCalledWith('t', 1, {
      kind: 'protocol',
      rejection: 'USER_REJECTED',
    })
    expect(toastError).toHaveBeenCalledOnce()
    expect(approvals.listApprovals()).toEqual([])
  })

  it('marks a request with an INVALID verification for the dialog to warn about', async () => {
    const request = signRequest('t', 1)
    request.verifyContext.verified.validation = 'INVALID'
    handlers.onRequest(request)
    await flush()

    expect(approvals.listApprovals()[0].verification).toBe('invalid')
  })

  it('refuses a znn_send whose fromAddress is not the active account, before any dialog', async () => {
    const accountBlock = {
      blockType: 2,
      toAddress: ACCOUNT,
      tokenStandard: 'zts1znnxxxxxxxxxxxxx9z4ulx',
      amount: '1',
    }
    const sendRequest = (rpcId: number, fromAddress: string) =>
      signRequest('t', rpcId, {
        request: {
          method: 'znn_send',
          params: { accountBlock, fromAddress },
          expiryTimestamp: 1_900_000_000,
        },
      })

    handlers.onRequest(sendRequest(1, 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'))
    await flush()

    expect(client.respondError).toHaveBeenCalledWith('t', 1, {
      kind: 'literal',
      code: -32602,
      message: 'fromAddress is not the active account.',
    })
    expect(approvals.listApprovals()).toEqual([])

    // The same send from the active account is queued, so the refusal above
    // comes from the fromAddress check alone.
    handlers.onRequest(sendRequest(2, ACCOUNT))
    await flush()

    expect(approvals.listApprovals().map((a) => a.id)).toEqual(['wc:t:2'])
  })

  it('drops pending approvals when their session ends', async () => {
    handlers.onRequest(signRequest('t', 1))
    handlers.onRequest(signRequest('u', 2))
    await flush()

    handlers.onSessionEnded('t')

    expect(approvals.listApprovals().map((a) => a.id)).toEqual(['wc:u:2'])
  })
})

describe('WalletConnect proposals', () => {
  it('approves on the wallet’s current chain and carries the proposal expiry', async () => {
    stored.chainId = 3
    handlers.onProposal(
      proposal({
        requiredNamespaces: { zenon: { chains: ['zenon:3'], methods: ['znn_sign'], events: [] } },
      })
    )
    await flush()

    const [pending] = approvals.listApprovals()
    expect(pending).toEqual(
      expect.objectContaining({ expiresAt: 1_900_000_300_000, chainId: 3, account: ACCOUNT })
    )

    await approvals.getHandlers(pending.id)?.resolve({ kind: 'connect', address: ACCOUNT })
    expect(client.approveProposal).toHaveBeenCalledWith(77, {
      zenon: expect.objectContaining({ chains: ['zenon:3'], accounts: [`zenon:3:${ACCOUNT}`] }),
    })
  })

  it('rejects a proposal that requires another chain', async () => {
    handlers.onProposal(
      proposal({
        requiredNamespaces: { zenon: { chains: ['zenon:3'], methods: ['znn_sign'], events: [] } },
      })
    )
    await flush()

    expect(client.rejectProposal).toHaveBeenCalledWith(77, {
      kind: 'protocol',
      rejection: 'UNSUPPORTED_CHAINS',
    })
  })

  it('rejects a proposal that requires an unsupported event', async () => {
    handlers.onProposal(
      proposal({
        requiredNamespaces: {
          zenon: { chains: ['zenon:1'], methods: ['znn_sign'], events: ['accountsChanged'] },
        },
      })
    )
    await flush()

    expect(client.rejectProposal).toHaveBeenCalledWith(77, {
      kind: 'protocol',
      rejection: 'UNSUPPORTED_EVENTS',
    })
    expect(approvals.listApprovals()).toEqual([])
  })

  it('rejects a proposal from a peer flagged as a scam without showing it', async () => {
    handlers.onProposal(
      proposal({}, { verified: { origin: '', validation: 'VALID', verifyUrl: '', isScam: true } })
    )
    await flush()

    expect(client.rejectProposal).toHaveBeenCalledWith(77, {
      kind: 'protocol',
      rejection: 'USER_REJECTED',
    })
    expect(toastError).toHaveBeenCalledOnce()
    expect(approvals.listApprovals()).toEqual([])
  })
})

describe('WalletConnect session events', () => {
  it('emits on each session’s own chain', async () => {
    client.listSessions.mockReturnValue([session('t', 'zenon:1'), session('u', 'zenon:3')])

    await service.emitChainIdChange(3)

    expect(client.emit).toHaveBeenCalledWith('t', { name: 'chainIdChange', data: 3 }, 'zenon:1')
    expect(client.emit).toHaveBeenCalledWith('u', { name: 'chainIdChange', data: 3 }, 'zenon:3')
  })
})

describe('WalletConnect initialize', () => {
  it('retries after a failed init instead of caching the failure', async () => {
    vi.resetModules()
    const { WalletConnectService } = await import('@/core/walletconnect-service')
    const fresh = WalletConnectService.getInstance()
    client.init.mockRejectedValueOnce(new Error('relay unreachable'))

    await expect(fresh.initialize(client)).rejects.toThrow('relay unreachable')
    await expect(fresh.initialize(client)).resolves.toBeUndefined()
    expect(client.init).toHaveBeenCalledTimes(3) // once in beforeEach, twice here
  })
})

describe('WalletConnect session meta', () => {
  it('stores the verification and approval time under the new session topic', async () => {
    client.listSessions.mockReturnValue([session('topic-new')])
    handlers.onProposal(proposal())
    await flush()
    const [pending] = approvals.listApprovals()

    await approvals.getHandlers(pending.id)?.resolve({ kind: 'connect', address: ACCOUNT })

    expect(mocks.store.get(META_KEY)).toEqual({
      'topic-new': { verification: 'valid', approvedAt: expect.any(Number) },
    })
    const stored = mocks.store.get(META_KEY) as Record<string, { approvedAt: number }>
    expect(stored['topic-new'].approvedAt).toBeGreaterThan(0)
  })

  it('stores nothing when the proposal is rejected', async () => {
    handlers.onProposal(proposal())
    await flush()
    const [pending] = approvals.listApprovals()

    await approvals.getHandlers(pending.id)?.reject({ reason: 'userRejected' })
    await settleMeta()

    expect(client.rejectProposal).toHaveBeenCalled()
    expect(mocks.store.has(META_KEY)).toBe(false)
  })

  it('still approves the session when the meta cannot be stored', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const meta = await import('@/core/walletconnect-session-meta')
    vi.spyOn(meta, 'recordSessionMeta').mockRejectedValueOnce(new Error('disk'))
    client.listSessions.mockReturnValue([session('topic-new')])
    handlers.onProposal(proposal())
    await flush()
    const [pending] = approvals.listApprovals()

    await approvals.getHandlers(pending.id)?.resolve({ kind: 'connect', address: ACCOUNT })

    expect(client.approveProposal).toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })

  describe('pruning', () => {
    const live = { verification: 'valid', approvedAt: 5 }

    async function freshService(): Promise<{
      deliver(list: unknown[]): void
      finishInit(): void
      initialized: Promise<void>
    }> {
      vi.resetModules()
      const { WalletConnectService } = await import('@/core/walletconnect-service')
      const fresh = WalletConnectService.getInstance()
      let capture!: WalletConnectClientHandlers
      let finish!: () => void
      const gate = new Promise<void>((resolve) => (finish = resolve))
      const slow = {
        ...client,
        init: vi.fn(async (h: WalletConnectClientHandlers) => {
          capture = h
          h.onSessionsChanged([])
          await gate
        }),
      } as unknown as IWalletConnectClient
      const initialized = fresh.initialize(slow)
      await flush()
      return {
        deliver: (list) => capture.onSessionsChanged(list as never),
        finishInit: finish,
        initialized,
      }
    }

    it('prunes nothing for lists delivered before init resolves', async () => {
      mocks.store.set(META_KEY, { t: live })
      const svc = await freshService()
      svc.deliver([])
      await settleMeta()

      expect(mocks.store.get(META_KEY)).toEqual({ t: live })

      svc.finishInit()
      await svc.initialized
    })

    it('keeps the meta of a session restored by init and removes it when the session ends', async () => {
      mocks.store.set(META_KEY, { t: live })
      const svc = await freshService()
      svc.deliver([session('t')])

      svc.finishInit()
      await svc.initialized
      await settleMeta()
      expect(mocks.store.get(META_KEY)).toEqual({ t: live })

      svc.deliver([])
      await settleMeta()

      expect(mocks.store.get(META_KEY)).toEqual({})
    })

    it('prunes the meta of a session that is not in the restored list', async () => {
      mocks.store.set(META_KEY, { t: live, gone: live })
      const svc = await freshService()
      svc.deliver([session('t')])

      svc.finishInit()
      await svc.initialized
      await settleMeta()

      expect(mocks.store.get(META_KEY)).toEqual({ t: live })
    })
  })
})

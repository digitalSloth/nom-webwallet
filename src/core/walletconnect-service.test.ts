import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IWalletConnectClient, WalletConnectClientHandlers } from '@/core/walletconnect-client'

const ACCOUNT = 'z1qyqszqgpqyqszqgpqyqszqgpqyqszqgp3cfdqg'
const stored = { chainId: 1 }
const toastError = vi.fn()

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

/** Lets the un-awaited handler promises run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('__IS_EXTENSION__', false)
  stored.chainId = 1
  client = {
    init: vi.fn(async (h: WalletConnectClientHandlers) => {
      handlers = h
    }),
    pair: vi.fn(),
    listSessions: vi.fn(() => [session('t'), session('u')]),
    approveProposal: vi.fn(async () => {}),
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

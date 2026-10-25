import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { ApprovalAction, ApprovalHandlers, PendingApproval } from '@/core/dapp-approvals'

const ACCOUNT_A = 'z1account-a'
const ACCOUNT_B = 'z1account-b'

// What chrome.storage holds right now. Another window can change it while
// this window's useWallet() state still shows the old values.
const stored = { activeAccountAddress: ACCOUNT_A, chainId: 1 }

const walletState = {
  activeWallet: ref({
    baseAddress: 'z1base',
    accounts: [
      { address: ACCOUNT_A, index: 0 },
      { address: ACCOUNT_B, index: 1 },
    ],
  }),
  activeAccountAddress: ref<string | null>(ACCOUNT_A),
  loadWalletData: vi.fn(async () => {
    walletState.activeAccountAddress.value = stored.activeAccountAddress
  }),
}

const signMessage = vi.fn(() => ({ signature: 'sig', publicKey: 'pub' }))
const sendEmbeddedContractBlock = vi.fn(async (block: unknown) => block)

vi.mock('@/core/composables/useWallet', () => ({ useWallet: () => walletState }))
vi.mock('@/core/composables/useActivity', () => ({
  runActivity: (_label: string, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/core/session-manager', () => ({
  sessionManager: { getKeyStore: () => ({ getKeyPair: (index: number) => ({ index }) }) },
}))
vi.mock('@/core/message-signing', () => ({ signMessage }))
vi.mock('@/core/transaction-service', () => ({
  TransactionService: { getInstance: () => ({ sendEmbeddedContractBlock }) },
}))
vi.mock('@/core/zenon-service', () => ({
  readPersistedChainId: async () => stored.chainId,
}))

const { dequeueApproval, enqueueApproval, listApprovals } = await import('@/core/dapp-approvals')
const { useDappApprovals } = await import('@/core/composables/useDappApprovals')

function handlers(): ApprovalHandlers & {
  resolve: ReturnType<typeof vi.fn>
  reject: ReturnType<typeof vi.fn>
} {
  return { resolve: vi.fn(async () => {}), reject: vi.fn(async () => {}) }
}

function approval(
  action: ApprovalAction,
  overrides: Partial<PendingApproval> = {}
): PendingApproval {
  return {
    id: 'ip:1',
    surface: 'inpage',
    origin: 'https://dapp.example',
    peer: { name: 'dApp', url: 'https://dapp.example', icons: [] },
    createdAt: 0,
    account: ACCOUNT_A,
    chainId: 1,
    action,
    ...overrides,
  }
}

const SIGN: ApprovalAction = { kind: 'signMessage', message: 'hello' }
const SEND = { kind: 'sendBlock', block: { blockType: 2 } } as unknown as ApprovalAction

beforeEach(() => {
  stored.activeAccountAddress = ACCOUNT_A
  stored.chainId = 1
  walletState.activeAccountAddress.value = ACCOUNT_A
})

afterEach(() => {
  vi.clearAllMocks()
  for (const pending of listApprovals()) dequeueApproval(pending.id)
})

describe('useDappApprovals account binding', () => {
  it('signs with the bound account when nothing has changed', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN), h)

    await useDappApprovals().approve('ip:1')

    expect(h.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'signMessage', address: ACCOUNT_A, signature: 'sig' })
    )
    expect(listApprovals()).toEqual([])
  })

  it('refuses to sign after another window switched the active account', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN), h)
    stored.activeAccountAddress = ACCOUNT_B

    await useDappApprovals().approve('ip:1')

    expect(signMessage).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
    expect(listApprovals()).toEqual([])
  })

  it('refuses to send after another window switched the active account', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    stored.activeAccountAddress = ACCOUNT_B

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })

  it('refuses after the chain changed', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    stored.chainId = 3

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })

  it('refuses a connect bound to a different account', async () => {
    const h = handlers()
    enqueueApproval(approval({ kind: 'connect' }), h)
    stored.activeAccountAddress = ACCOUNT_B

    await useDappApprovals().approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })
})

describe('useDappApprovals expiry', () => {
  it('drops an expired request without signing or responding', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN, { expiresAt: Date.now() + 60_000 }), h)
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 120_000)

    await useDappApprovals().approve('ip:1')
    vi.useRealTimers()

    expect(signMessage).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
    expect(listApprovals()).toEqual([])
  })
})

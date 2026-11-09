import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type { ApprovalAction, ApprovalHandlers, PendingApproval } from '@/core/dapp-approvals'

const ACCOUNT_A = 'z1account-a'
const ACCOUNT_B = 'z1account-b'
const ACCOUNT_C = 'z1account-c'

type MockWallet = { baseAddress: string; accounts: { address: string; index: number }[] }
const WALLET_A: MockWallet = {
  baseAddress: 'z1base',
  accounts: [
    { address: ACCOUNT_A, index: 0 },
    { address: ACCOUNT_B, index: 1 },
  ],
}
const WALLET_B: MockWallet = {
  baseAddress: 'z1base-b',
  accounts: [{ address: ACCOUNT_C, index: 0 }],
}

// What chrome.storage holds right now. Another window can change it while
// this window's useWallet() state still shows the old values.
const stored = { activeWallet: WALLET_A, activeAccountAddress: ACCOUNT_A, chainId: 1 }

const walletState = {
  activeWallet: ref<MockWallet>(WALLET_A),
  activeAccountAddress: ref<string | null>(ACCOUNT_A),
  isActiveWalletUnlocked: ref(true),
  lockAllWallets: vi.fn(),
  loadWalletData: vi.fn(async () => {
    walletState.activeWallet.value = stored.activeWallet
    walletState.activeAccountAddress.value = stored.activeAccountAddress
    return true
  }),
}

// The key store of the active wallet; null models a wallet with no session.
const session: {
  keyStore: { getKeyPair(index: number): { index: number } } | null
} = { keyStore: null }
const DEFAULT_KEY_STORE = { getKeyPair: (index: number) => ({ index }) }

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void
let storageListener: StorageListener = () => {}
const removeListener = vi.fn()

vi.stubGlobal('chrome', {
  storage: {
    onChanged: {
      addListener: (listener: StorageListener) => (storageListener = listener),
      removeListener,
    },
  },
})

const signMessage = vi.fn(() => ({ signature: 'sig', publicKey: 'pub' }))
const sendEmbeddedContractBlock = vi.fn(async (block: unknown) => block)

vi.mock('@/core/composables/useWallet', () => ({ useWallet: () => walletState }))
vi.mock('@/core/composables/useTxTracker', () => ({ trackTransaction: vi.fn() }))
vi.mock('@/core/composables/useActivity', () => ({
  runActivity: (_label: string, run: () => Promise<unknown>) => run(),
}))
vi.mock('@/core/session-manager', () => ({
  sessionManager: { getKeyStore: () => session.keyStore },
}))
vi.mock('@/core/message-signing', () => ({ signMessage }))
vi.mock('@/core/transaction-service', () => ({
  TransactionService: { getInstance: () => ({ sendEmbeddedContractBlock }) },
}))
vi.mock('@/core/zenon-service', () => ({
  readPersistedChainId: async () => stored.chainId,
}))

const { dequeueApproval, enqueueApproval, listApprovals } = await import('@/core/dapp-approvals')
const { useDappApprovals, watchWalletStorage } = await import('@/core/composables/useDappApprovals')

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
  stored.activeWallet = WALLET_A
  stored.activeAccountAddress = ACCOUNT_A
  stored.chainId = 1
  walletState.activeWallet.value = WALLET_A
  walletState.activeAccountAddress.value = ACCOUNT_A
  walletState.isActiveWalletUnlocked.value = true
  session.keyStore = DEFAULT_KEY_STORE
})

afterAll(() => {
  vi.unstubAllGlobals()
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

  it('rejects with sendFailed and passes the send error text through as the detail', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    sendEmbeddedContractBlock.mockRejectedValueOnce(new Error('The outcome is unknown: timed out'))

    await useDappApprovals().approve('ip:1')

    expect(h.reject).toHaveBeenCalledWith({
      reason: 'sendFailed',
      detail: 'The outcome is unknown: timed out',
    })
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

  it('sends with the account the request was bound to when this window loaded an older account', async () => {
    // This window loaded ACCOUNT_A, then another window switched to ACCOUNT_B
    // before the dApp sent, so the worker bound the request to ACCOUNT_B.
    stored.activeAccountAddress = ACCOUNT_B
    const h = handlers()
    enqueueApproval(approval(SEND, { account: ACCOUNT_B }), h)

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).toHaveBeenCalledWith(
      expect.anything(),
      { index: 1 },
      expect.any(Function)
    )
    expect(h.reject).not.toHaveBeenCalled()
  })

  it('signs with the account the request was bound to when this window loaded an older account', async () => {
    stored.activeAccountAddress = ACCOUNT_B
    const h = handlers()
    enqueueApproval(approval(SIGN, { account: ACCOUNT_B }), h)

    await useDappApprovals().approve('ip:1')

    expect(signMessage).toHaveBeenCalledWith('hello', { index: 1 })
    expect(h.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'signMessage', address: ACCOUNT_B })
    )
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

describe('useDappApprovals failed storage read', () => {
  it('rejects with walletLocked and does not sign when the re-read fails', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN), h)
    walletState.loadWalletData.mockImplementationOnce(async () => false)

    await useDappApprovals().approve('ip:1')

    expect(signMessage).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'walletLocked' })
    expect(listApprovals()).toEqual([])
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

describe('useDappApprovals notices and mismatch', () => {
  async function flush(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  }

  async function refuseSwitchedAccount(): Promise<void> {
    enqueueApproval(approval(SIGN), handlers())
    stored.activeAccountAddress = ACCOUNT_B
    await useDappApprovals().approve('ip:1')
  }

  it('refuses with accountChanged after another window switched to a different wallet', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN), h)
    stored.activeWallet = WALLET_B
    stored.activeAccountAddress = ACCOUNT_C

    const { approve, notice } = useDappApprovals()
    await approve('ip:1')

    expect(signMessage).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
    expect(notice.value).toBe('accountChanged')
  })

  it('reports accountChanged when it refuses a switched account', async () => {
    await refuseSwitchedAccount()

    expect(useDappApprovals().notice.value).toBe('accountChanged')
  })

  it.each([
    ['SIGN', SIGN],
    ['SEND', SEND],
  ])(
    'keeps the request and reports needsUnlock when the active wallet has no session (%s)',
    async (_name, action) => {
      const h = handlers()
      enqueueApproval(approval(action), h)
      session.keyStore = null

      const { approve, notice } = useDappApprovals()
      await approve('ip:1')

      expect(signMessage).not.toHaveBeenCalled()
      expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
      expect(h.resolve).not.toHaveBeenCalled()
      expect(h.reject).not.toHaveBeenCalled()
      expect(listApprovals()).toHaveLength(1)
      expect(notice.value).toBe('needsUnlock')
    }
  )

  it('clears the notice on the next reject', async () => {
    await refuseSwitchedAccount()
    enqueueApproval(approval(SIGN), handlers())

    const { reject, notice } = useDappApprovals()
    await reject('ip:1')

    expect(notice.value).toBeNull()
  })

  it('clears the notice on the next approve', async () => {
    await refuseSwitchedAccount()
    const h = handlers()
    enqueueApproval(approval(SIGN, { id: 'ip:2', account: ACCOUNT_B }), h)

    const { approve, notice } = useDappApprovals()
    await approve('ip:2')

    expect(notice.value).toBeNull()
    expect(h.resolve).toHaveBeenCalled()
  })

  it('flags a request bound to an account that is no longer active', async () => {
    enqueueApproval(approval(SIGN), handlers())
    const { accountMismatch } = useDappApprovals()
    expect(accountMismatch.value).toBe(false)

    stored.activeAccountAddress = ACCOUNT_B
    watchWalletStorage()
    storageListener({ 'nom-wallet-storage': {} }, 'local')
    await flush()

    expect(walletState.loadWalletData).toHaveBeenCalledTimes(1)
    expect(accountMismatch.value).toBe(true)
  })

  it('ignores session-area and unrelated storage changes', async () => {
    watchWalletStorage()
    storageListener({ 'nom-wallet-storage': {} }, 'session')
    storageListener({ 'nom-wallet-chain-id': {} }, 'local')
    await flush()

    expect(walletState.loadWalletData).not.toHaveBeenCalled()
  })

  it('removes its storage listener', () => {
    const stop = watchWalletStorage()
    stop()

    expect(removeListener).toHaveBeenCalledWith(storageListener)
  })

  it('shows no mismatch without an active account', () => {
    enqueueApproval(approval(SIGN), handlers())
    walletState.activeAccountAddress.value = null

    expect(useDappApprovals().accountMismatch.value).toBe(false)
  })

  it('shows no mismatch without a current approval', () => {
    stored.activeAccountAddress = ACCOUNT_B
    walletState.activeAccountAddress.value = ACCOUNT_B

    expect(useDappApprovals().accountMismatch.value).toBe(false)
  })
})

describe('useDappApprovals needsUnlockPrompt', () => {
  it('prompts when the active wallet is locked and the account matches', () => {
    enqueueApproval(approval(SIGN), handlers())
    walletState.isActiveWalletUnlocked.value = false

    expect(useDappApprovals().needsUnlockPrompt.value).toBe(true)
  })

  it('does not prompt when the active wallet is unlocked', () => {
    enqueueApproval(approval(SIGN), handlers())

    expect(useDappApprovals().needsUnlockPrompt.value).toBe(false)
  })

  it('does not prompt when the request is bound to another account', () => {
    enqueueApproval(approval(SIGN), handlers())
    walletState.isActiveWalletUnlocked.value = false
    walletState.activeAccountAddress.value = ACCOUNT_C

    expect(useDappApprovals().needsUnlockPrompt.value).toBe(false)
  })
})

describe('useDappApprovals settleEmptyLocked', () => {
  it('closes the window when no notice is pending', () => {
    const close = vi.fn()

    useDappApprovals().settleEmptyLocked(close)

    expect(close).toHaveBeenCalledTimes(1)
    expect(walletState.lockAllWallets).not.toHaveBeenCalled()
  })

  it('locks every wallet and keeps the window open when a notice is pending', async () => {
    enqueueApproval(approval(SIGN), handlers())
    stored.activeAccountAddress = ACCOUNT_B
    const { approve, notice, settleEmptyLocked } = useDappApprovals()
    await approve('ip:1')
    const close = vi.fn()

    settleEmptyLocked(close)

    expect(walletState.lockAllWallets).toHaveBeenCalledTimes(1)
    expect(notice.value).toBeNull()
    expect(close).not.toHaveBeenCalled()
  })

  it('does nothing while an approval is pending', () => {
    enqueueApproval(approval(SIGN), handlers())
    const close = vi.fn()

    useDappApprovals().settleEmptyLocked(close)

    expect(close).not.toHaveBeenCalled()
    expect(walletState.lockAllWallets).not.toHaveBeenCalled()
  })
})

describe('useDappApprovals approval lifetime', () => {
  const EXPIRES_AT = 1_900_000_000_000

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(EXPIRES_AT - 1000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Runs `during` in the middle of approve(), while the storage re-read is
  // still pending.
  function duringReload(during: () => void): void {
    walletState.loadWalletData.mockImplementationOnce(async () => {
      during()
      walletState.activeWallet.value = stored.activeWallet
      walletState.activeAccountAddress.value = stored.activeAccountAddress
      return true
    })
  }

  type BeforePublish = () => void
  const sendMock = sendEmbeddedContractBlock as unknown as ReturnType<
    typeof vi.fn<
      (block: unknown, keyPair: unknown, beforePublish?: BeforePublish) => Promise<unknown>
    >
  >

  it('does not sign when the approval expires during the storage re-read', async () => {
    const h = handlers()
    enqueueApproval(approval(SIGN, { expiresAt: EXPIRES_AT }), h)
    duringReload(() => vi.setSystemTime(EXPIRES_AT))

    await useDappApprovals().approve('ip:1')

    expect(signMessage).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
    expect(listApprovals()).toEqual([])
  })

  it('does not send when the approval is dropped during the storage re-read', async () => {
    const { dropApprovals } = await import('@/core/dapp-approvals')
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    duringReload(() => dropApprovals((a) => a.id === 'ip:1'))

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
  })

  it('stops the publish when the approval expires during PoW', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND, { expiresAt: EXPIRES_AT }), h)
    const published = vi.fn()
    sendMock.mockImplementationOnce(async (block, _keyPair, beforePublish) => {
      vi.setSystemTime(EXPIRES_AT)
      beforePublish?.()
      published()
      return block
    })

    await useDappApprovals().approve('ip:1')

    expect(published).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
    expect(listApprovals()).toEqual([])
  })

  it('stops the publish when the approval is dropped during PoW', async () => {
    const { dropApprovals } = await import('@/core/dapp-approvals')
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    const published = vi.fn()
    sendMock.mockImplementationOnce(async (block, _keyPair, beforePublish) => {
      dropApprovals((a) => a.id === 'ip:1')
      beforePublish?.()
      published()
      return block
    })

    await useDappApprovals().approve('ip:1')

    expect(published).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
  })

  it('publishes and resolves an approval that is still live after PoW', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND, { expiresAt: EXPIRES_AT }), h)
    const published = vi.fn()
    sendMock.mockImplementationOnce(async (block, _keyPair, beforePublish) => {
      beforePublish?.()
      published()
      return block
    })

    await useDappApprovals().approve('ip:1')

    expect(published).toHaveBeenCalledOnce()
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sendBlock' }))
  })
})

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { KeyStore, ZNN_ZTS, type AccountBlockTemplate } from 'znn-typescript-sdk'

import type { ApprovalAction, ApprovalHandlers, PendingApproval } from '@/core/dapp-approvals'
import { envelopeLength, openMessage } from '@/core/message-envelope'

const MESSAGE_ENTROPY_A = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const MESSAGE_ENTROPY_B = 'f0e0d0c0b0a090807060504030201000ffeeddccbbaa99887766554433221100'

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
  wallets: ref<MockWallet[]>([WALLET_A, WALLET_B]),
  lockAllWallets: vi.fn(),
  setActiveAccount: vi.fn(async (address: string) => {
    const owner = walletState.wallets.value.find((w) =>
      w.accounts.some((a) => a.address === address)
    )
    if (!owner) throw new Error('unknown account')
    stored.activeWallet = owner
    stored.activeAccountAddress = address
    await walletState.loadWalletData()
  }),
  loadWalletData: vi.fn(async () => {
    walletState.activeWallet.value = stored.activeWallet
    walletState.activeAccountAddress.value = stored.activeAccountAddress
    return true
  }),
}

// The key store of the active wallet; null models a wallet with no session.
const session: {
  keyStore: { getKeyPair(index: number): unknown } | null
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
const sendEmbeddedContractBlock = vi.fn(async (...args: unknown[]) => args[0])

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
const assertNoUnresolvedCall = vi.fn(async (): Promise<string | undefined> => undefined)
vi.mock('@/core/contract-guard', () => ({ assertNoUnresolvedCall }))
vi.mock('@/core/zenon-service', () => ({
  readPersistedChainId: async () => stored.chainId,
}))

const { dequeueApproval, enqueueApproval, getHandlers, listApprovals, rebindApproval } =
  await import('@/core/dapp-approvals')
const { useDappApprovals, watchWalletStorage } = await import('@/core/composables/useDappApprovals')
const { trackTransaction } = await import('@/core/composables/useTxTracker')

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

const CONNECT: ApprovalAction = { kind: 'connect' }
const SIGN: ApprovalAction = { kind: 'signMessage', message: 'hello' }
const SEND = {
  kind: 'sendBlock',
  block: {
    blockType: 2,
    toAddress: { toString: () => 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz' },
    amount: { toString: () => '100' },
    tokenStandard: { toString: () => 'zts1znnxxxxxxxxxxxxx9z4ulx' },
    data: new Uint8Array(),
    hash: { toString: () => 'h1' },
  },
} as unknown as ApprovalAction

beforeEach(() => {
  stored.activeWallet = WALLET_A
  stored.activeAccountAddress = ACCOUNT_A
  stored.chainId = 1
  walletState.activeWallet.value = WALLET_A
  walletState.activeAccountAddress.value = ACCOUNT_A
  walletState.isActiveWalletUnlocked.value = true
  walletState.wallets.value = [WALLET_A, WALLET_B]
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

  it('refuses a request an unresolved earlier call blocks and sends nothing', async () => {
    const h = handlers()
    enqueueApproval(approval(SEND), h)
    assertNoUnresolvedCall.mockRejectedValueOnce(new Error('A previous burn may still be sending.'))

    await useDappApprovals().approve('ip:1')

    expect(assertNoUnresolvedCall).toHaveBeenCalledWith(expect.anything(), ACCOUNT_A)
    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({
      reason: 'sendFailed',
      detail: 'A previous burn may still be sending.',
    })
  })

  it('stores the guard key on the send record', async () => {
    enqueueApproval(approval(SEND), handlers())
    assertNoUnresolvedCall.mockResolvedValueOnce('Token.Burn:zts1')

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ call: 'Token.Burn:zts1' })
    )
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
      expect.any(Function),
      expect.objectContaining({
        kind: 'send',
        from: ACCOUNT_B,
        origin: 'https://dapp.example',
      })
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

describe('useDappApprovals approve result', () => {
  it('returns the sent block hash for a send', async () => {
    enqueueApproval(approval(SEND), handlers())

    const result = await useDappApprovals().approve('ip:1')

    expect(result).toEqual({ kind: 'sendBlock', hash: 'h1' })
  })

  it('returns null for a connect, a sign and an expired request', async () => {
    const { approve } = useDappApprovals()
    enqueueApproval(approval({ kind: 'connect' }), handlers())
    expect(await approve('ip:1')).toBeNull()

    enqueueApproval(approval(SIGN), handlers())
    expect(await approve('ip:1')).toBeNull()

    enqueueApproval(approval(SEND, { expiresAt: Date.now() - 1 }), handlers())
    expect(await approve('ip:1')).toBeNull()
    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
  })

  it('returns null when the send fails', async () => {
    enqueueApproval(approval(SEND), handlers())
    sendEmbeddedContractBlock.mockRejectedValueOnce(new Error('boom'))

    expect(await useDappApprovals().approve('ip:1')).toBeNull()
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

  it('clears the notice and keeps the window open without locking', async () => {
    enqueueApproval(approval(SIGN), handlers())
    stored.activeAccountAddress = ACCOUNT_B
    const { approve, notice, settleEmptyLocked } = useDappApprovals()
    await approve('ip:1')
    const close = vi.fn()

    settleEmptyLocked(close)

    expect(walletState.lockAllWallets).not.toHaveBeenCalled()
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

describe('useDappApprovals queuePosition', () => {
  it('counts requests handled since the queue was last empty', async () => {
    const { queuePosition } = useDappApprovals()
    enqueueApproval(approval(SIGN, { id: 'ip:1' }), handlers())
    enqueueApproval(approval(SIGN, { id: 'ip:2' }), handlers())
    expect(queuePosition.value).toEqual({ index: 1, total: 2 })

    await useDappApprovals().approve('ip:1')
    expect(queuePosition.value).toEqual({ index: 2, total: 2 })

    await useDappApprovals().approve('ip:2')
    expect(queuePosition.value).toEqual({ index: 1, total: 0 })

    enqueueApproval(approval(SIGN, { id: 'ip:3' }), handlers())
    expect(queuePosition.value).toEqual({ index: 1, total: 1 })
  })

  it('drops the total but keeps the index when a request behind the head leaves', () => {
    const { queuePosition } = useDappApprovals()
    enqueueApproval(approval(SIGN, { id: 'ip:1' }), handlers())
    enqueueApproval(approval(SIGN, { id: 'ip:2' }), handlers())

    dequeueApproval('ip:2')

    expect(queuePosition.value).toEqual({ index: 1, total: 1 })
  })

  it('counts a rejected head as handled', async () => {
    const { queuePosition } = useDappApprovals()
    enqueueApproval(approval(SIGN, { id: 'ip:1' }), handlers())
    enqueueApproval(approval(SIGN, { id: 'ip:2' }), handlers())

    await useDappApprovals().reject('ip:1')

    expect(queuePosition.value).toEqual({ index: 2, total: 2 })
  })

  it('counts an expired head as handled', () => {
    vi.useFakeTimers()
    try {
      const { queuePosition } = useDappApprovals()
      enqueueApproval(approval(SIGN, { id: 'ip:1', expiresAt: Date.now() + 1000 }), handlers())
      enqueueApproval(approval(SIGN, { id: 'ip:2' }), handlers())

      vi.advanceTimersByTime(2000)
      enqueueApproval(approval(SIGN, { id: 'ip:3' }), handlers())

      expect(queuePosition.value).toEqual({ index: 2, total: 3 })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useDappApprovals transaction meta', () => {
  it('passes decimals and symbol for a ZNN send', async () => {
    enqueueApproval(approval(SEND), handlers())

    await useDappApprovals().approve('ip:1')

    expect(trackTransaction).toHaveBeenCalledWith(
      'dApp transaction',
      expect.anything(),
      expect.objectContaining({ decimals: 8, symbol: 'ZNN' })
    )
  })

  it('omits decimals and symbol for another token', async () => {
    const other = {
      kind: 'sendBlock',
      block: {
        ...(SEND as { block: object }).block,
        tokenStandard: { toString: () => 'zts1abcdefghjklmnpqrstuvwxy' },
      },
    } as unknown as ApprovalAction
    enqueueApproval(approval(other), handlers())

    await useDappApprovals().approve('ip:1')

    const meta = vi.mocked(trackTransaction).mock.calls[0][2] as Record<string, unknown>
    expect(meta).toMatchObject({ tokenStandard: 'zts1abcdefghjklmnpqrstuvwxy' })
    expect(meta).not.toHaveProperty('decimals')
    expect(meta).not.toHaveProperty('symbol')
  })
})

describe('rebindApproval', () => {
  it('replaces only the account of a connect entry and keeps the queue position', () => {
    const { queuePosition } = useDappApprovals()
    enqueueApproval(approval(CONNECT, { id: 'ip:1' }), handlers())
    enqueueApproval(approval(SIGN, { id: 'ip:2' }), handlers())
    const before = listApprovals()[0]

    expect(rebindApproval('ip:1', ACCOUNT_C)).toBe(true)

    const [head, second] = listApprovals()
    expect(head).toEqual({ ...before, account: ACCOUNT_C })
    expect(second.account).toBe(ACCOUNT_A)
    expect(queuePosition.value).toEqual({ index: 1, total: 2 })
  })

  it('replaces the head object so watchers see a new request', () => {
    enqueueApproval(approval(CONNECT), handlers())
    const before = listApprovals()[0]

    rebindApproval('ip:1', ACCOUNT_C)

    expect(listApprovals()[0]).not.toBe(before)
    expect(before.account).toBe(ACCOUNT_A)
  })

  it('refuses a sign entry and leaves it bound', () => {
    enqueueApproval(approval(SIGN), handlers())

    expect(rebindApproval('ip:1', ACCOUNT_C)).toBe(false)
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })

  it('refuses a send entry', () => {
    enqueueApproval(approval(SEND), handlers())

    expect(rebindApproval('ip:1', ACCOUNT_C)).toBe(false)
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })

  it('refuses an unknown id', () => {
    enqueueApproval(approval(CONNECT), handlers())

    expect(rebindApproval('ip:nope', ACCOUNT_C)).toBe(false)
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })
})

describe('useDappApprovals changeConnectAccount', () => {
  function withRebind(result: boolean | Error = true) {
    const h = handlers()
    const rebind = vi.fn<(account: string) => Promise<boolean>>(async () => {
      if (result instanceof Error) throw result
      return result
    })
    return Object.assign(h, { rebind })
  }

  async function expectNothingChanged(h: { rebind?: ReturnType<typeof vi.fn> }): Promise<void> {
    expect(h.rebind).not.toHaveBeenCalled()
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  }

  it('refuses an id that is not the head', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT, { id: 'ip:1' }), withRebind())
    enqueueApproval(approval(CONNECT, { id: 'ip:2' }), h)

    expect(await useDappApprovals().changeConnectAccount('ip:2', ACCOUNT_C)).toBe('refused')
    await expectNothingChanged(h)
  })

  it('refuses when the head is a sign request', async () => {
    enqueueApproval(approval(SIGN), handlers())

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })

  it('refuses when the head is a send request', async () => {
    enqueueApproval(approval(SEND), handlers())

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
  })

  it('refuses a late pick for a request that is no longer the head', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT, { id: 'ip:1' }), h)
    const controls = useDappApprovals()
    dequeueApproval('ip:1')
    enqueueApproval(approval(CONNECT, { id: 'ip:2' }), withRebind())

    expect(await controls.changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    await expectNothingChanged(h)
  })

  it('refuses while another action is busy', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    const controls = useDappApprovals()

    const first = controls.changeConnectAccount('ip:1', ACCOUNT_C)
    const second = await controls.changeConnectAccount('ip:1', ACCOUNT_B)

    expect(second).toBe('refused')
    expect(await first).toBe('changed')
    expect(h.rebind).toHaveBeenCalledTimes(1)
    expect(h.rebind).toHaveBeenCalledWith(ACCOUNT_C)
  })

  it('refuses an address in no wallet', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', 'z1stranger')).toBe('refused')
    await expectNothingChanged(h)
  })

  it('refuses when the request expired', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT, { expiresAt: Date.now() - 1 }), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(h.rebind).not.toHaveBeenCalled()
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
  })

  it('refuses when the wallet data cannot be read', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    walletState.loadWalletData.mockResolvedValueOnce(false)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    await expectNothingChanged(h)
  })

  it('calls rebind, then setActiveAccount, then re-binds the page entry', async () => {
    const order: string[] = []
    const h = withRebind()
    h.rebind.mockImplementation(async () => {
      order.push(`rebind:${listApprovals()[0].account}`)
      return true
    })
    walletState.setActiveAccount.mockImplementationOnce(async () => {
      order.push(`switch:${listApprovals()[0].account}`)
    })
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('changed')

    expect(order).toEqual([`rebind:${ACCOUNT_A}`, `switch:${ACCOUNT_A}`])
    expect(h.rebind).toHaveBeenCalledWith(ACCOUNT_C)
    expect(walletState.setActiveAccount).toHaveBeenCalledWith(ACCOUNT_C)
    expect(listApprovals()[0].account).toBe(ACCOUNT_C)
  })

  it('switches nothing when the worker refuses', async () => {
    const h = withRebind(false)
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })

  it('switches nothing when rebind throws', async () => {
    const h = withRebind(new Error('no worker'))
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)
  })

  it('refuses when the request lapses while the worker is asked', async () => {
    const h = withRebind()
    h.rebind.mockImplementation(async () => {
      dequeueApproval('ip:1')
      return true
    })
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(walletState.setActiveAccount).not.toHaveBeenCalled()
  })

  it('leaves the page entry on the old account when setActiveAccount throws', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    walletState.setActiveAccount.mockRejectedValueOnce(new Error('storage'))

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('refused')
    expect(listApprovals()[0].account).toBe(ACCOUNT_A)

    // approve then still binds to the old account, which is still active.
    await useDappApprovals().approve('ip:1')
    expect(h.resolve).toHaveBeenCalledWith({ kind: 'connect', address: ACCOUNT_A })
  })

  it('switches and re-binds when there is no rebind handler', async () => {
    const h = handlers()
    enqueueApproval(approval(CONNECT), h)

    expect(await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)).toBe('changed')
    expect(walletState.setActiveAccount).toHaveBeenCalledWith(ACCOUNT_C)
    expect(listApprovals()[0].account).toBe(ACCOUNT_C)
  })

  it('approves the new account after a change', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    const controls = useDappApprovals()

    await controls.changeConnectAccount('ip:1', ACCOUNT_C)
    await controls.approve('ip:1')

    expect(h.resolve).toHaveBeenCalledWith({ kind: 'connect', address: ACCOUNT_C })
    expect(h.reject).not.toHaveBeenCalled()
  })

  it('still refuses the approve when the active account moved after the change', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    const controls = useDappApprovals()
    await controls.changeConnectAccount('ip:1', ACCOUNT_C)

    // Another window switches the active account before the click.
    stored.activeWallet = WALLET_A
    stored.activeAccountAddress = ACCOUNT_B
    await controls.approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })

  it('refuses the approve when the displayed account is stale against the bound and active ones', async () => {
    const h = withRebind()
    enqueueApproval(approval(CONNECT), h)
    // The page entry is re-bound but the active account was not switched.
    rebindApproval('ip:1', ACCOUNT_C)

    await useDappApprovals().approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })

  it('rejects a sign request queued behind the connect and bound to the old account', async () => {
    const sign = handlers()
    enqueueApproval(approval(CONNECT, { id: 'ip:1' }), withRebind())
    enqueueApproval(approval(SIGN, { id: 'ip:2' }), sign)
    const controls = useDappApprovals()

    await controls.changeConnectAccount('ip:1', ACCOUNT_C)
    await controls.approve('ip:1')
    await controls.approve('ip:2')

    expect(sign.resolve).not.toHaveBeenCalled()
    expect(sign.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
    expect(signMessage).not.toHaveBeenCalled()
  })

  it('never re-binds a sign or send entry through the page queue', async () => {
    const h = withRebind()
    enqueueApproval(approval(SIGN), h)

    await useDappApprovals().changeConnectAccount('ip:1', ACCOUNT_C)

    expect(getHandlers('ip:1')).toBe(h)
    expect(h.rebind).not.toHaveBeenCalled()
  })
})

describe('useDappApprovals message access', () => {
  const MESSAGE_ACCESS: ApprovalAction = { kind: 'messageAccess' }

  it('resolves the bound address when the wallet is unlocked', async () => {
    const h = handlers()
    enqueueApproval(approval(MESSAGE_ACCESS), h)

    const result = await useDappApprovals().approve('ip:1')

    expect(result).toBeNull()
    expect(h.resolve).toHaveBeenCalledWith({ kind: 'messageAccess', address: ACCOUNT_A })
    expect(signMessage).not.toHaveBeenCalled()
    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
  })

  it('keeps the request and reports needsUnlock when the wallet is locked', async () => {
    const h = handlers()
    enqueueApproval(approval(MESSAGE_ACCESS), h)
    session.keyStore = null

    const { approve, notice } = useDappApprovals()
    await approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
    expect(listApprovals()).toHaveLength(1)
    expect(notice.value).toBe('needsUnlock')
  })

  it('rejects with accountChanged when the active account switched', async () => {
    const h = handlers()
    enqueueApproval(approval(MESSAGE_ACCESS), h)
    stored.activeAccountAddress = ACCOUNT_B

    await useDappApprovals().approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })
})

describe('useDappApprovals send encrypted message', () => {
  const sender = KeyStore.fromEntropy(MESSAGE_ENTROPY_A)
  const recipient = KeyStore.fromEntropy(MESSAGE_ENTROPY_B)
  const senderPair = sender.getKeyPair(0)
  const recipientPair = recipient.getKeyPair(0)
  const content = { body: 'Hello B', replyTo: 'ab'.repeat(32) }

  function sendMessage(overrides: Partial<PendingApproval> = {}): PendingApproval {
    return approval(
      {
        kind: 'sendMessage',
        to: recipientPair.address.toString(),
        recipientPublicKey: recipientPair.publicKey.toString('hex'),
        content,
        envelopeBytes: envelopeLength(content),
      },
      overrides
    )
  }

  beforeEach(() => {
    session.keyStore = { getKeyPair: () => senderPair }
  })

  it('publishes a ZNN block of amount 0 to the recipient that opens as the recipient and the sender', async () => {
    const h = handlers()
    enqueueApproval(sendMessage(), h)

    const result = await useDappApprovals().approve('ip:1')

    const block = sendEmbeddedContractBlock.mock.calls[0][0] as unknown as AccountBlockTemplate
    expect(block.blockType).toBe(2)
    expect(block.toAddress.toString()).toBe(recipientPair.address.toString())
    expect(block.tokenStandard.toString()).toBe(ZNN_ZTS.toString())
    expect(block.amount).toBe(0n)
    expect(block.data.subarray(0, 4)).toEqual(Buffer.from([0xff, 0x7a, 0x6d, 0x73]))
    expect(block.data.length).toBe(envelopeLength(content))

    const open = (own: typeof senderPair, other: typeof senderPair, outgoing: boolean) =>
      openMessage({
        ownSeed: own.privateKey,
        ownPublicKey: own.publicKey,
        counterpartyPublicKey: other.publicKey,
        envelope: block.data,
        outgoing,
      })
    expect(open(recipientPair, senderPair, false)).toEqual({ ok: true, ...content })
    expect(open(senderPair, recipientPair, true)).toEqual({ ok: true, ...content })
    expect(result).toEqual({ kind: 'sendBlock', hash: block.hash.toString() })
    expect(h.resolve).toHaveBeenCalledWith({ kind: 'sendBlock', block })
  })

  it('records the send as an encrypted message', async () => {
    enqueueApproval(sendMessage(), handlers())

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock.mock.calls[0][3]).toMatchObject({
      title: 'Encrypted message',
      kind: 'send',
      amount: '0',
      recipient: recipientPair.address.toString(),
      from: ACCOUNT_A,
    })
  })

  it('keeps the request and reports needsUnlock when the wallet is locked', async () => {
    const h = handlers()
    enqueueApproval(sendMessage(), h)
    session.keyStore = null

    const { approve, notice } = useDappApprovals()
    await approve('ip:1')

    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.reject).not.toHaveBeenCalled()
    expect(notice.value).toBe('needsUnlock')
    expect(listApprovals()).toHaveLength(1)
  })

  it('rejects with accountChanged when the active account switched', async () => {
    const h = handlers()
    enqueueApproval(sendMessage(), h)
    stored.activeAccountAddress = ACCOUNT_B

    await useDappApprovals().approve('ip:1')

    expect(sendEmbeddedContractBlock).not.toHaveBeenCalled()
    expect(h.reject).toHaveBeenCalledWith({ reason: 'accountChanged' })
  })

  it('rejects with sendFailed carrying the node message when publishing fails', async () => {
    const h = handlers()
    enqueueApproval(sendMessage(), h)
    sendEmbeddedContractBlock.mockRejectedValueOnce(new Error('Not enough plasma'))

    await useDappApprovals().approve('ip:1')

    expect(h.reject).toHaveBeenCalledWith({ reason: 'sendFailed', detail: 'Not enough plasma' })
  })

  it('publishes nothing when the approval lapses during the send', async () => {
    const h = handlers()
    enqueueApproval(sendMessage({ expiresAt: Date.now() + 60_000 }), h)
    sendEmbeddedContractBlock.mockImplementationOnce(async (_block, _pair, check) => {
      dequeueApproval('ip:1')
      ;(check as () => void)()
      return {}
    })

    await useDappApprovals().approve('ip:1')

    expect(h.resolve).not.toHaveBeenCalled()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Address, TOKEN_ADDRESS, TokenStandard, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'

// A fake node behind the real shared send path: the real form check, click
// flow, contract action, owned-tokens composable, token service, contract
// send and transaction service. Only the node (token read, PoW and publish),
// the key store and the tracker are faked.
const node = vi.hoisted(() => ({
  prepareBlock: vi.fn(),
  publishRawTransaction: vi.fn(),
  getByZts: vi.fn(),
  getKeyPair: vi.fn(),
}))

vi.mock('@/core/zenon-service', async () => {
  const { Zenon } = await import('znn-typescript-sdk')
  const real = Zenon.getInstance().embedded.token
  const zenon = {
    embedded: {
      token: {
        mint: real.mint.bind(real),
        burnToken: real.burnToken.bind(real),
        updateToken: real.updateToken.bind(real),
        getByZts: node.getByZts,
      },
    },
    prepareBlock: node.prepareBlock,
    ledger: { publishRawTransaction: node.publishRawTransaction },
  }
  const service = { getZenon: () => zenon, ensureInitialized: async () => undefined }
  return { ZenonService: { getInstance: () => service } }
})
vi.mock('@/core/session-manager', () => ({
  sessionManager: { getKeyStore: () => ({ getKeyPair: node.getKeyPair }) },
}))
vi.mock('@/core/composables/useTxTracker', () => ({
  trackTransaction: vi.fn(),
  trackRejected: vi.fn(),
  useTrackedTransactions: () => ({ get: () => null }),
}))
import { SEND_TIMEOUT_MS } from '@/config'
import { decodeContractCall } from '@/core/contract-call'
import { TOKEN_CHANGED_MESSAGE, useOwnedTokens } from '@/core/composables/useOwnedTokens'
import { getSendRecorder, setSendRecorder } from '@/core/send-recorder'
import type { SendContext, SendRecorder } from '@/core/send-recorder'
import { formatAmount } from '@/shared/lib/amount'
import { must } from '@/test/must'
import type { BalanceInfo, Wallet } from '@/types'
import { runContractAction } from './contract-action'
import { actionKey } from './token-actions'
import type { TokenActionMode } from './token-actions'
import { useTokenAction } from './token-action-submit'

const user = (n: number) => Address.fromPublicKey(Buffer.alloc(32, n)).toString()
const FROM = user(1)
const SECOND = user(2)
const OUTSIDE = user(3)
// A new token per test, so a pending key from an earlier test never carries over.
let TOKEN_ZTS = ''
let tokenCount = 0
const MAX_RAW = 2n ** 255n - 1n

const wallet = {
  baseAddress: FROM,
  accounts: [
    { address: FROM, index: 0 },
    { address: SECOND, index: 1 },
  ],
} as unknown as Wallet
const contractWallet = {
  refreshLockState: vi.fn(),
  activeWallet: { value: wallet },
  isActiveWalletUnlocked: { value: true },
  activeAccountAddress: { value: FROM },
} as never

type Chain = {
  owner: string
  totalSupply: bigint
  maxSupply: bigint
  isMintable: boolean
  isBurnable: boolean
  decimals: number
}
let chain: Chain
let recorded: SendContext[] = []
const previousRecorder = getSendRecorder()

const sdkToken = () => ({
  tokenStandard: { toString: () => TOKEN_ZTS },
  name: 'Test token',
  symbol: 'TST',
  decimals: chain.decimals,
  owner: { toString: () => chain.owner },
  totalSupply: chain.totalSupply,
  maxSupply: chain.maxSupply,
  isMintable: chain.isMintable,
  isBurnable: chain.isBurnable,
  isUtility: false,
})

// The dialog's wiring, as TokenActionDialog.vue builds it.
async function dialog(mode: TokenActionMode, balance = '1000000000000') {
  const tokens = useOwnedTokens()
  const list: BalanceInfo[] = [
    { tokenStandard: TOKEN_ZTS, balance, decimals: chain.decimals, symbol: 'TST', name: 'Test' },
  ]
  const onSent = vi.fn()
  const state = useTokenAction({
    mode,
    address: FROM,
    tokenStandard: TOKEN_ZTS,
    ownAccounts: () => [FROM, SECOND],
    balances: () => ({ list, loading: false }),
    tokens,
    run: (key, from, meta, send) =>
      runContractAction({ key, from, wallet: contractWallet, meta, node: 'node.test', send }),
    onSent,
  })
  await vi.waitFor(() => expect(state.facts.value).not.toBeNull())
  return { state, onSent }
}

function decoded(block: AccountBlockTemplate) {
  const call = decodeContractCall(block.toAddress.toString(), block.data)
  return { call, arg: (name: string) => call?.args.find((a) => a.name === name)?.value }
}

const published = () => node.publishRawTransaction.mock.calls[0][0] as AccountBlockTemplate

beforeEach(() => {
  recorded = []
  tokenCount += 1
  TOKEN_ZTS = TokenStandard.fromCore(Buffer.alloc(10, tokenCount)).toString()
  chain = {
    owner: FROM,
    totalSupply: 100_00000000n,
    maxSupply: 200_00000000n,
    isMintable: true,
    isBurnable: false,
    decimals: 8,
  }
  const recorder: SendRecorder = {
    begin: (context) => {
      recorded.push(context)
      return { publishing() {}, published() {}, abandon() {}, detach() {} }
    },
    release: async () => undefined,
  }
  setSendRecorder(recorder)
  node.prepareBlock.mockReset()
  node.publishRawTransaction.mockReset()
  node.getByZts.mockReset()
  node.getKeyPair.mockReset()
  node.getKeyPair.mockReturnValue({})
  node.getByZts.mockImplementation(async () => sdkToken())
  node.prepareBlock.mockImplementation(async (block: AccountBlockTemplate) =>
    Object.assign(block, { hash: { toString: () => 'ab'.repeat(32) } })
  )
  node.publishRawTransaction.mockImplementation(async (block: unknown) => block)
})
afterEach(() => {
  setSendRecorder(previousRecorder)
  vi.useRealTimers()
})

describe('mint: what Review shows is what the node receives', () => {
  it('publishes one Mint with the reviewed token, amount and recipient and 0 ZNN', async () => {
    const { state, onSent } = await dialog('mint')
    state.amount.value = '12.34567891'
    state.to.value = ` ${SECOND.toUpperCase()} `
    const reviewed = must(state.mintCheck.value?.params)
    expect(reviewed.receiveAddress).toBe(SECOND)

    await state.submit()

    expect(node.prepareBlock).toHaveBeenCalledTimes(1)
    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
    const block = published()
    const { call, arg } = decoded(block)
    expect(call?.method).toBe('Mint')
    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(block.amount).toBe(0n)
    expect(block.tokenStandard.toString()).toBe(ZNN_ZTS.toString())
    expect(arg('tokenStandard')).toBe(reviewed.tokenStandard)
    expect(arg('amount')).toBe(reviewed.amount.toString())
    expect(arg('amount')).toBe('1234567891')
    expect(arg('receiveAddress')).toBe(reviewed.receiveAddress)
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it('records a send context that matches the meta', async () => {
    const { state } = await dialog('mint')
    state.amount.value = '5'
    state.to.value = OUTSIDE
    await state.submit()

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      kind: 'contract',
      from: FROM,
      title: 'Token · Mint 5 TST',
      amount: '500000000',
      symbol: 'TST',
      tokenStandard: TOKEN_ZTS,
      recipient: OUTSIDE,
    })
  })

  it('mints the full remainder of a 2^255 - 1 max supply at 18 decimals exactly', async () => {
    chain = { ...chain, decimals: 18, totalSupply: 0n, maxSupply: MAX_RAW }
    const { state } = await dialog('mint')
    state.amount.value = formatAmount(MAX_RAW, 18)
    await state.submit()

    expect(decoded(published()).arg('amount')).toBe(MAX_RAW.toString())
    expect(recorded[0].amount).toBe(MAX_RAW.toString())
  })

  it('never publishes above the remainder, a contract recipient or a malformed amount', async () => {
    const { state } = await dialog('mint')
    for (const [amount, to] of [
      ['100.00000001', FROM],
      ['1', TOKEN_ADDRESS.toString()],
      ['1', TOKEN_ADDRESS.toString().toUpperCase()],
      ['1e3', FROM],
      ['-1', FROM],
      ['', FROM],
    ]) {
      state.amount.value = amount
      state.to.value = to
      await state.submit()
    }
    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
  })
})

describe('burn: what Review shows is what the node receives', () => {
  it('publishes one empty Burn with the amount in the burned token', async () => {
    chain.isBurnable = true
    const { state } = await dialog('burn')
    state.amount.value = '3.5'
    const reviewed = must(state.burnCheck.value?.params)

    await state.submit()

    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
    const block = published()
    const { call } = decoded(block)
    expect(call?.method).toBe('Burn')
    expect(call?.args).toEqual([])
    expect(block.amount).toBe(reviewed.amount)
    expect(block.amount).toBe(3_50000000n)
    expect(block.tokenStandard.toString()).toBe(reviewed.tokenStandard)
    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(recorded[0]).toMatchObject({
      kind: 'contract',
      from: FROM,
      title: 'Token · Burn 3.5 TST',
      amount: '350000000',
      tokenStandard: TOKEN_ZTS,
    })
  })

  it('burns the exact balance at 18 decimals and refuses one raw unit more', async () => {
    chain = { ...chain, decimals: 18, isBurnable: true }
    const balance = 123456789012345678901234567890n
    const { state } = await dialog('burn', balance.toString())

    state.amount.value = formatAmount(balance + 1n, 18)
    await state.submit()
    expect(node.prepareBlock).not.toHaveBeenCalled()

    state.amount.value = formatAmount(balance, 18)
    await state.submit()
    expect(published().amount).toBe(balance)
  })

  it('lets a non-owner burn a burnable token', async () => {
    chain = { ...chain, owner: OUTSIDE, isBurnable: true }
    const { state } = await dialog('burn')
    state.amount.value = '1'
    await state.submit()

    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
  })

  it('never publishes for a non-owner of a token that is not burnable', async () => {
    chain = { ...chain, owner: OUTSIDE, isBurnable: false }
    const { state } = await dialog('burn')
    state.amount.value = '1'
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
  })
})

describe('manage: what Review shows is what the node receives', () => {
  it('publishes one UpdateToken with the reviewed owner and both flags and 0 ZNN', async () => {
    const { state } = await dialog('manage')
    state.owner.value = ` ${SECOND.toUpperCase()}`
    state.confirmedOwner.value = SECOND
    state.setMintable(false)
    state.mintOffConfirmed.value = true
    state.burnable.value = true
    const reviewed = must(state.updateCheck.value?.params)

    await state.submit()

    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
    const block = published()
    const { call, arg } = decoded(block)
    expect(call?.method).toBe('UpdateToken')
    expect(block.amount).toBe(0n)
    expect(block.tokenStandard.toString()).toBe(ZNN_ZTS.toString())
    expect(arg('tokenStandard')).toBe(reviewed.tokenStandard)
    expect(arg('owner')).toBe(SECOND)
    expect(String(arg('isMintable'))).toBe('false')
    expect(String(arg('isBurnable'))).toBe('true')
    expect(recorded[0]).toMatchObject({
      kind: 'contract',
      from: FROM,
      title: 'Token · Manage TST',
      recipient: SECOND,
    })
  })

  it('never publishes a new owner without its tick box or with a contract address', async () => {
    const { state } = await dialog('manage')
    state.owner.value = OUTSIDE
    await state.submit()
    state.confirmedOwner.value = OUTSIDE
    state.owner.value = SECOND
    await state.submit()
    state.owner.value = TOKEN_ADDRESS.toString().toUpperCase()
    state.confirmedOwner.value = TOKEN_ADDRESS.toString()
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
  })

  it('never publishes turning minting off without its tick box', async () => {
    const { state } = await dialog('manage')
    state.setMintable(false)
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
  })
})

describe('fresh read before send', () => {
  it('refuses a mint when the supply grew since the dialog opened', async () => {
    const { state } = await dialog('mint')
    state.amount.value = '100'
    chain.totalSupply += 1n
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(0)
    expect(state.actionError.value?.message).toBe(TOKEN_CHANGED_MESSAGE)
  })

  it.each([
    ['the owner changed', { owner: OUTSIDE }],
    ['minting was turned off', { isMintable: false }],
  ])('refuses a mint when %s', async (_name, change) => {
    const { state } = await dialog('mint')
    state.amount.value = '1'
    Object.assign(chain, change)
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
  })

  it('refuses a burn when the token is no longer burnable for a non-owner', async () => {
    chain = { ...chain, owner: OUTSIDE, isBurnable: true }
    const { state } = await dialog('burn')
    state.amount.value = '1'
    chain.isBurnable = false
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['the owner changed', { owner: OUTSIDE }],
    ['burnable changed', { isBurnable: true }],
    ['minting was turned off', { isMintable: false }],
  ])('refuses a Manage save when %s, then re-reads the form', async (_name, change) => {
    const { state } = await dialog('manage')
    state.burnable.value = true
    Object.assign(chain, change)
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
    expect(state.actionError.value?.message).toBe(TOKEN_CHANGED_MESSAGE)
    expect(state.confirmedOwner.value).toBeNull()
    expect(state.facts.value?.owner).toBe(chain.owner)
    expect(state.facts.value?.isMintable).toBe(chain.isMintable)
  })

  it('refuses everything when the read fails, with nothing sent', async () => {
    const { state } = await dialog('mint')
    state.amount.value = '1'
    node.getByZts.mockRejectedValue(new Error('down'))
    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(state.actionError.value?.message).toContain('Nothing was sent')
  })
})

describe('timeout', () => {
  it('keeps the button disabled after a timed-out burn and sends nothing more', async () => {
    chain.isBurnable = true
    const { state } = await dialog('burn')
    state.amount.value = '1'
    vi.useFakeTimers()
    node.prepareBlock.mockImplementation(() => new Promise(() => undefined))

    const sending = state.submit()
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1)
    await sending

    expect(state.actionError.value?.timeout).toBe(true)
    expect(state.busy.value).toBe(true)
    expect(state.pendingElsewhere.value).toBe(false)
    expect(state.key.value).toBe(actionKey('burn', FROM, TOKEN_ZTS))

    await state.submit()
    await state.submit()
    expect(node.prepareBlock).toHaveBeenCalledTimes(1)
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
  })
})

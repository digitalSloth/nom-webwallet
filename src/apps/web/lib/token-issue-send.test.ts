import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_ADDRESS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'

// A fake node behind the real shared send path: the real form check, click
// flow, contract action, issue composable, token service, contract send and
// transaction service. Only the node (PoW and publish), the key store and
// the tracker are faked.
const node = vi.hoisted(() => ({
  prepareBlock: vi.fn(),
  publishRawTransaction: vi.fn(),
  getKeyPair: vi.fn(),
}))

vi.mock('@/core/zenon-service', async () => {
  const { Zenon } = await import('znn-typescript-sdk')
  const zenon = {
    embedded: Zenon.getInstance().embedded,
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

import { SEND_TIMEOUT_MS, TOKEN_ISSUE_FEE } from '@/config'
import { decodeContractCall } from '@/core/contract-call'
import { useOwnedTokens } from '@/core/composables/useOwnedTokens'
import { NODE_REFUSAL_MESSAGES } from '@/core/node-refusal-messages'
import { getSendRecorder, setSendRecorder } from '@/core/send-recorder'
import type { SendContext, SendRecorder } from '@/core/send-recorder'
import { formatAmount } from '@/shared/lib/amount'
import { must } from '@/test/must'
import type { Wallet } from '@/types'
import { runContractAction } from './contract-action'
import { issueMeta, parseIssueForm } from './token-issue'
import type { IssueForm } from './token-issue'
import { useIssueSubmit } from './token-issue-submit'

const FROM = 'z1me'
const wallet = {
  baseAddress: 'z1base',
  accounts: [{ address: FROM, index: 0 }],
} as unknown as Wallet
const contractWallet = {
  refreshLockState: vi.fn(),
  activeWallet: { value: wallet },
  isActiveWalletUnlocked: { value: true },
  activeAccountAddress: { value: FROM },
} as never

const MAX_RAW = 2n ** 255n - 1n
const form = (over: Partial<IssueForm> = {}): IssueForm => ({
  name: 'MyToken',
  symbol: 'myt',
  domain: 'example.com',
  decimals: '8',
  totalSupply: '1000',
  maxSupply: '2000',
  mintable: true,
  burnable: false,
  utility: true,
  ...over,
})

let n = 0
let recorded: SendContext[] = []
const previousRecorder = getSendRecorder()

// The page's wiring, as TokenIssue.vue builds it.
function page(f: IssueForm, balance: bigint | null = TOKEN_ISSUE_FEE + 5n) {
  const key = `token-issue:z1send${n++}`
  const tokens = useOwnedTokens()
  const navigate = vi.fn(async () => undefined)
  const state = useIssueSubmit({
    key,
    address: FROM,
    form: () => f,
    znnBalance: () => balance,
    run: (from, params) => {
      const meta = issueMeta(params)
      return runContractAction({
        key,
        from,
        wallet: contractWallet,
        meta,
        node: 'node.test',
        send: (w) => tokens.issue(w, from, params, meta),
      })
    },
    navigate,
  })
  return { state, navigate }
}

function arg(block: AccountBlockTemplate, name: string): string | undefined {
  const call = decodeContractCall(block.toAddress.toString(), block.data)
  expect(call?.method).toBe('IssueToken')
  return call?.args.find((a) => a.name === name)?.value
}

beforeEach(() => {
  recorded = []
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
  node.getKeyPair.mockReset()
  node.getKeyPair.mockReturnValue({})
  node.prepareBlock.mockImplementation(async (block: AccountBlockTemplate) =>
    Object.assign(block, { hash: { toString: () => 'ab'.repeat(32) } })
  )
  node.publishRawTransaction.mockImplementation(async (block: unknown) => block)
})
afterEach(() => {
  setSendRecorder(previousRecorder)
  vi.useRealTimers()
})

describe('what Review shows is what the node receives', () => {
  it('sends the checked params, the exact fee and the same meta', async () => {
    const f = form()
    const reviewed = must(parseIssueForm(f, TOKEN_ISSUE_FEE).params)
    const { state, navigate } = page(f)

    await state.submit()

    expect(node.prepareBlock).toHaveBeenCalledTimes(1)
    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
    const block = node.publishRawTransaction.mock.calls[0][0] as AccountBlockTemplate
    expect(block.amount).toBe(100_000_000n)
    expect(block.toAddress.toString()).toBe(TOKEN_ADDRESS.toString())
    expect(block.tokenStandard.toString()).toBe(ZNN_ZTS.toString())
    expect(arg(block, 'tokenName')).toBe(reviewed.name)
    expect(arg(block, 'tokenSymbol')).toBe('MYT')
    expect(arg(block, 'tokenDomain')).toBe('example.com')
    expect(arg(block, 'totalSupply')).toBe(reviewed.totalSupply.toString())
    expect(arg(block, 'maxSupply')).toBe(reviewed.maxSupply.toString())
    expect(arg(block, 'decimals')).toBe('8')
    expect(String(arg(block, 'isMintable'))).toBe('true')
    expect(String(arg(block, 'isBurnable'))).toBe('false')
    expect(String(arg(block, 'isUtility'))).toBe('true')

    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      kind: 'contract',
      from: FROM,
      title: 'Token · Issue MYT',
      amount: '100000000',
      symbol: 'ZNN',
      tokenStandard: ZNN_ZTS.toString(),
    })
    expect(navigate).toHaveBeenCalledWith('ab'.repeat(32))
  })

  it('sends the maximum supply at 18 decimals exactly as reviewed', async () => {
    const f = form({
      decimals: '18',
      totalSupply: formatAmount(MAX_RAW, 18),
      maxSupply: formatAmount(MAX_RAW, 18),
      domain: '',
    })
    const reviewed = must(parseIssueForm(f, TOKEN_ISSUE_FEE).params)
    expect(reviewed.totalSupply).toBe(MAX_RAW)
    const { state } = page(f)

    await state.submit()

    const block = node.publishRawTransaction.mock.calls[0][0] as AccountBlockTemplate
    expect(arg(block, 'totalSupply')).toBe(MAX_RAW.toString())
    expect(arg(block, 'maxSupply')).toBe(MAX_RAW.toString())
    expect(arg(block, 'decimals')).toBe('18')
    expect(block.amount).toBe(100_000_000n)
  })

  it('sends a fixed supply with max equal to total', async () => {
    const f = form({ mintable: false, totalSupply: '1000', maxSupply: '5' })
    const { state } = page(f)

    await state.submit()

    const block = node.publishRawTransaction.mock.calls[0][0] as AccountBlockTemplate
    expect(arg(block, 'totalSupply')).toBe('100000000000')
    expect(arg(block, 'maxSupply')).toBe('100000000000')
    expect(String(arg(block, 'isMintable'))).toBe('false')
  })
})

describe('refusals before PoW', () => {
  it('does not run PoW, send or record when the balance is below 1 ZNN', async () => {
    const { state, navigate } = page(form(), TOKEN_ISSUE_FEE - 1n)

    await state.submit()

    expect(node.prepareBlock).not.toHaveBeenCalled()
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
    expect(recorded).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not run PoW for a form the node would refuse', async () => {
    for (const bad of [
      form({ domain: 'x.com' }),
      form({ symbol: 'ZNN' }),
      form({ decimals: '19' }),
      form({ name: 'a'.repeat(41) }),
      form({ totalSupply: '3000', maxSupply: '2000' }),
    ]) {
      await page(bad).state.submit()
    }
    expect(node.prepareBlock).not.toHaveBeenCalled()
  })
})

describe('node refusal and timeout', () => {
  it('shows the refusal, sends no second block and lets the user try again', async () => {
    node.publishRawTransaction.mockRejectedValueOnce({
      code: -32000,
      message: NODE_REFUSAL_MESSAGES[0],
    })
    const { state } = page(form())

    await state.submit()

    expect(state.actionError.value?.timeout).toBe(false)
    expect(state.actionError.value?.message).toContain(NODE_REFUSAL_MESSAGES[0])
    expect(node.publishRawTransaction).toHaveBeenCalledTimes(1)
    expect(state.busy.value).toBe(false)
  })

  it('disables Issue for the session after a timed-out send', async () => {
    vi.useFakeTimers()
    node.prepareBlock.mockImplementation(() => new Promise(() => undefined))
    const { state } = page(form())

    const sending = state.submit()
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1)
    await sending

    expect(state.actionError.value?.timeout).toBe(true)
    expect(state.busy.value).toBe(true)
    expect(state.pendingElsewhere.value).toBe(false)

    await state.submit()
    await state.submit()
    expect(node.prepareBlock).toHaveBeenCalledTimes(1)
    expect(node.publishRawTransaction).not.toHaveBeenCalled()
  })

  it('disables Issue on another page for the same account after a timeout', async () => {
    vi.useFakeTimers()
    node.prepareBlock.mockImplementation(() => new Promise(() => undefined))
    const key = 'token-issue:z1send-shared'
    const sharedPage = () => {
      const tokens = useOwnedTokens()
      return useIssueSubmit({
        key,
        address: FROM,
        form: () => form(),
        znnBalance: () => TOKEN_ISSUE_FEE,
        run: (from, params) => {
          const meta = issueMeta(params)
          return runContractAction({
            key,
            from,
            wallet: contractWallet,
            meta,
            node: 'node.test',
            send: (w) => tokens.issue(w, from, params, meta),
          })
        },
        navigate: async () => undefined,
      })
    }
    const a = sharedPage()
    const sending = a.submit()
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS + 1)
    await sending

    const b = sharedPage()
    expect(b.pendingElsewhere.value).toBe(true)
    await b.submit()
    expect(node.prepareBlock).toHaveBeenCalledTimes(1)
  })
})

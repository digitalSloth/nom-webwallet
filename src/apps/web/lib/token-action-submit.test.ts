import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { Address } from 'znn-typescript-sdk'
import type { Token } from 'znn-typescript-sdk'

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: () => null }),
  trackRejected: vi.fn(),
}))

import { TOKEN_CHANGED_MESSAGE } from '@/core/composables/useOwnedTokens'
import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { must } from '@/test/must'
import type { BalanceInfo } from '@/types'
import type { ActionResult } from './contract-action'
import { claimPending, settlePending } from '@/shared/lib/pending-calls'
import { burnMeta, mintMeta, tokenFacts, updateMeta } from './token-actions'
import type { TokenActionMode } from './token-actions'
import { useTokenAction } from './token-action-submit'
import type { TokenActionDeps } from './token-action-submit'

const user = (n: number) => Address.fromPublicKey(Buffer.alloc(32, n)).toString()
const SECOND = user(2)
const OUTSIDE = user(3)
const EXTRA = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'

const timeoutResult = { kind: 'error', message: SEND_TIMEOUT_MESSAGE, timeout: true } as const
const sentResult = { kind: 'sent', hash: 'h1' } as const

let n = 0
// Each test gets its own account, so its pending keys never collide.
function setup(
  mode: TokenActionMode,
  over: Partial<TokenActionDeps> = {},
  tokenOver: Record<string, unknown> = {}
) {
  const index = n++
  const address = user(10 + index)
  const zts = `zts1token${index}xxxxxxxxxxxx`
  const token = {
    tokenStandard: { toString: () => zts },
    name: 'Test',
    symbol: 'TST',
    decimals: 8,
    owner: { toString: () => address },
    totalSupply: 100_00000000n,
    maxSupply: 200_00000000n,
    isMintable: true,
    isBurnable: true,
    ...tokenOver,
  } as unknown as Token
  const balances: BalanceInfo[] = [
    { tokenStandard: zts, balance: '1000000000', decimals: 8, symbol: 'TST', name: 'Test' },
  ]
  const deps: TokenActionDeps = {
    mode,
    address,
    tokenStandard: zts,
    ownAccounts: () => [address, SECOND],
    balances: () => ({ list: balances, loading: false }),
    tokens: {
      findToken: vi.fn(async () => token),
      mint: vi.fn(),
      burn: vi.fn(),
      update: vi.fn(),
    } as unknown as TokenActionDeps['tokens'],
    run: vi.fn(async (): Promise<ActionResult> => sentResult),
    onSent: vi.fn(),
    ...over,
  }
  const scope = effectScope()
  const state = must(scope.run(() => useTokenAction(deps)))
  return { deps, state, scope, address, zts, token }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

describe('load', () => {
  it('reads the token once for a set tokenStandard and fills the Manage fields', async () => {
    const { deps, state, zts, address } = setup(
      'manage',
      {},
      { isMintable: false, isBurnable: true }
    )
    await flush()

    expect(deps.tokens.findToken).toHaveBeenCalledTimes(1)
    expect(deps.tokens.findToken).toHaveBeenCalledWith(zts)
    expect(state.zts.value).toBe(zts)
    expect(state.facts.value?.owner).toBe(address)
    expect(state.owner.value).toBe(address)
    expect(state.mintable.value).toBe(false)
    expect(state.burnable.value).toBe(true)
    expect(state.confirmedOwner.value).toBeNull()
    expect(state.mintOffConfirmed.value).toBe(false)
    expect(state.loading.value).toBe(false)
  })

  it('does not read for the burn picker until a token is selected', async () => {
    const { deps, state } = setup('burn', { tokenStandard: null })
    await flush()

    expect(deps.tokens.findToken).not.toHaveBeenCalled()
    expect(state.zts.value).toBeNull()
    expect(state.facts.value).toBeNull()
    expect(state.key.value).toBeNull()
  })

  it('sets loadError and no facts for a null read', async () => {
    const { state } = setup('mint', {
      tokens: { findToken: vi.fn(async () => null) } as unknown as TokenActionDeps['tokens'],
    })
    await flush()

    expect(state.facts.value).toBeNull()
    expect(state.loadError.value).toBe("This token doesn't exist on this network.")
    expect(state.loading.value).toBe(false)
  })

  it('sets loadError to the message of a throw, or a fallback', async () => {
    const failing = (err: unknown) =>
      ({
        findToken: vi.fn(async () => {
          throw err
        }),
      }) as unknown as TokenActionDeps['tokens']
    const a = setup('mint', { tokens: failing(new Error('node down')) })
    const b = setup('mint', { tokens: failing(new Error('')) })
    await flush()

    expect(a.state.facts.value).toBeNull()
    expect(a.state.loadError.value).toBe('node down')
    expect(b.state.loadError.value).toBe("Couldn't read this token")
  })

  it('keeps the facts of the last select when an earlier read resolves last', async () => {
    const first = deferred<Token>()
    const second = deferred<Token>()
    const findToken = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { state } = setup('burn', {
      tokenStandard: null,
      tokens: { findToken } as unknown as TokenActionDeps['tokens'],
    })
    const tokenOf = (zts: string) =>
      ({
        tokenStandard: { toString: () => zts },
        name: zts,
        symbol: zts.toUpperCase(),
        decimals: 8,
        owner: { toString: () => 'z1owner' },
        totalSupply: 1n,
        maxSupply: 2n,
        isMintable: true,
        isBurnable: true,
      }) as unknown as Token

    state.select('ztsa')
    state.select('ztsb')
    second.resolve(tokenOf('ztsb'))
    await flush()
    first.resolve(tokenOf('ztsa'))
    await flush()

    expect(state.zts.value).toBe('ztsb')
    expect(state.facts.value?.tokenStandard).toBe('ztsb')
    expect(state.loading.value).toBe(false)
  })

  it('clears the amount and facts on select', async () => {
    const { state } = setup('burn', { tokenStandard: null })
    state.amount.value = '5'
    state.select('zts1next')

    expect(state.amount.value).toBe('')
    expect(state.facts.value).toBeNull()
    expect(state.zts.value).toBe('zts1next')
  })

  it('ignores select while a send is running', async () => {
    const pending = deferred<ActionResult>()
    const { state } = setup('burn', { run: vi.fn(() => pending.promise) })
    await flush()
    state.amount.value = '1'
    const sending = state.submit()
    await flush()
    expect(state.submitting.value).toBe(true)

    state.select('zts1other')
    expect(state.zts.value).not.toBe('zts1other')

    pending.resolve(sentResult)
    await sending
  })
})

describe('submit guards', () => {
  it('never calls run for an empty or invalid mint', async () => {
    const { deps, state, address } = setup('mint')
    await flush()
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()

    state.amount.value = '101'
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()

    state.amount.value = '1'
    state.to.value = EXTRA
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
    expect(state.to.value).not.toBe(address)
  })

  it('never calls run for a burn above the balance or while the balance is unknown', async () => {
    const a = setup('burn')
    await flush()
    a.state.amount.value = '10.00000001'
    await a.state.submit()
    expect(a.deps.run).not.toHaveBeenCalled()

    const b = setup('burn', { balances: () => ({ list: [], loading: true }) })
    await flush()
    b.state.amount.value = '1'
    expect(b.state.balance.value).toBeNull()
    await b.state.submit()
    expect(b.deps.run).not.toHaveBeenCalled()
  })

  it('never calls run for a burn of a token the account cannot burn', async () => {
    const { deps, state } = setup(
      'burn',
      {},
      { isBurnable: false, owner: { toString: () => 'z1x' } }
    )
    await flush()
    state.amount.value = '1'
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('never calls run for a Manage form that is unchanged or lacks a confirmation', async () => {
    const { deps, state } = setup('manage')
    await flush()
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()

    state.owner.value = SECOND
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()

    state.owner.value = state.facts.value?.owner ?? ''
    state.setMintable(false)
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('never calls run when the token has not loaded', async () => {
    const { deps, state } = setup('mint', {
      tokens: { findToken: vi.fn(async () => null) } as unknown as TokenActionDeps['tokens'],
    })
    await flush()
    state.amount.value = '1'
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('what run receives', () => {
  it('runs a mint under its key with the checked params and meta', async () => {
    const { deps, state, address, zts } = setup('mint')
    await flush()
    state.amount.value = '1.5'
    state.to.value = SECOND.toUpperCase()
    await state.submit()

    const facts = must(state.facts.value)
    const params = { tokenStandard: zts, amount: 1_50000000n, receiveAddress: SECOND }
    expect(deps.run).toHaveBeenCalledTimes(1)
    const [key, from, meta, send] = vi.mocked(deps.run).mock.calls[0]
    expect(key).toBe(`token-mint:${address}:${zts}`)
    expect(from).toBe(address)
    expect(meta).toEqual(mintMeta(params, facts))

    const wallet = {} as never
    await send(wallet)
    expect(deps.tokens.mint).toHaveBeenCalledTimes(1)
    const [w, f, p, m] = vi.mocked(deps.tokens.mint).mock.calls[0]
    expect(w).toBe(wallet)
    expect(f).toBe(address)
    expect(p).toEqual(params)
    expect(m).toBe(meta)
  })

  it('passes the same params and meta objects to the composable', async () => {
    const { deps, state } = setup('mint')
    await flush()
    state.amount.value = '1'
    const checked = must(state.mintCheck.value?.params)
    await state.submit()
    const send = vi.mocked(deps.run).mock.calls[0][3]
    await send({} as never)

    // the params the button was enabled for equal the params sent
    expect(vi.mocked(deps.tokens.mint).mock.calls[0][2]).toEqual(checked)
    expect(vi.mocked(deps.run).mock.calls[0][2]).toBe(vi.mocked(deps.tokens.mint).mock.calls[0][3])
  })

  it('runs a burn under its key with the checked params and meta', async () => {
    const { deps, state, address, zts } = setup('burn')
    await flush()
    state.amount.value = '10'
    await state.submit()

    const facts = must(state.facts.value)
    const params = { tokenStandard: zts, amount: 10_00000000n }
    const [key, from, meta, send] = vi.mocked(deps.run).mock.calls[0]
    expect(key).toBe(`token-burn:${address}:${zts}`)
    expect(from).toBe(address)
    expect(meta).toEqual(burnMeta(params, facts))
    await send({} as never)
    const [, f, p, m] = vi.mocked(deps.tokens.burn).mock.calls[0]
    expect(f).toBe(address)
    expect(p).toEqual(params)
    expect(m).toBe(meta)
  })

  it('runs a Manage under the update key with the loaded values', async () => {
    const { deps, state, address, zts } = setup('manage', {}, { isBurnable: false })
    await flush()
    state.owner.value = SECOND
    state.confirmedOwner.value = SECOND
    state.setMintable(false)
    state.mintOffConfirmed.value = true
    state.burnable.value = true
    await state.submit()

    const facts = must(state.facts.value)
    const params = { tokenStandard: zts, owner: SECOND, mintable: false, burnable: true }
    const [key, from, meta, send] = vi.mocked(deps.run).mock.calls[0]
    expect(key).toBe(`token-update:${address}:${zts}`)
    expect(from).toBe(address)
    expect(meta).toEqual(updateMeta(params, facts))
    await send({} as never)
    const [, f, p, loaded, m] = vi.mocked(deps.tokens.update).mock.calls[0]
    expect(f).toBe(address)
    expect(p).toEqual(params)
    expect(loaded).toEqual({ owner: address, mintable: true, burnable: false })
    expect(m).toBe(meta)
  })

  it('does not send a new owner after the address is edited past its confirmation', async () => {
    const { deps, state } = setup('manage')
    await flush()
    state.owner.value = SECOND
    state.confirmedOwner.value = SECOND
    state.owner.value = OUTSIDE
    await state.submit()

    expect(deps.run).not.toHaveBeenCalled()
  })

  it('clears the mint-off confirmation when minting is switched back on', async () => {
    const { state } = setup('manage')
    await flush()
    state.setMintable(false)
    state.mintOffConfirmed.value = true
    state.setMintable(true)

    expect(state.mintable.value).toBe(true)
    expect(state.mintOffConfirmed.value).toBe(false)
  })
})

describe('result handling', () => {
  it('calls onSent when sent', async () => {
    const { deps, state } = setup('burn')
    await flush()
    state.amount.value = '1'
    await state.submit()

    expect(deps.onSent).toHaveBeenCalledTimes(1)
    expect(state.actionError.value).toBeNull()
    expect(state.submitting.value).toBe(false)
  })

  it('does not call onSent after the scope stopped mid-run', async () => {
    const pending = deferred<ActionResult>()
    const { deps, state, scope } = setup('burn', { run: vi.fn(() => pending.promise) })
    await flush()
    state.amount.value = '1'
    const sending = state.submit()
    await flush()
    scope.stop()
    pending.resolve(sentResult)
    await sending

    expect(deps.onSent).not.toHaveBeenCalled()
  })

  it('does not call run again while the first run is unresolved', async () => {
    const pending = deferred<ActionResult>()
    const { deps, state } = setup('burn', { run: vi.fn(() => pending.promise) })
    await flush()
    state.amount.value = '1'
    const first = state.submit()
    await flush()
    expect(state.busy.value).toBe(true)

    await state.submit()
    await state.submit()
    expect(deps.run).toHaveBeenCalledTimes(1)

    pending.resolve(sentResult)
    await first
  })

  it('shows a refusal, frees the form and does not re-read for another error', async () => {
    const { deps, state } = setup('burn', {
      run: vi.fn(async () => ({ kind: 'error', message: 'refused', timeout: false }) as const),
    })
    await flush()
    state.amount.value = '1'
    await state.submit()

    expect(state.actionError.value).toEqual({ message: 'refused', timeout: false })
    expect(state.busy.value).toBe(false)
    expect(deps.tokens.findToken).toHaveBeenCalledTimes(1)
    expect(deps.onSent).not.toHaveBeenCalled()
  })

  it('does nothing visible for a skipped run', async () => {
    const { deps, state } = setup('burn', {
      run: vi.fn(async () => ({ kind: 'skipped' }) as const),
    })
    await flush()
    state.amount.value = '1'
    await state.submit()

    expect(state.actionError.value).toBeNull()
    expect(deps.onSent).not.toHaveBeenCalled()
    expect(state.busy.value).toBe(false)
  })

  it('reads again after TOKEN_CHANGED_MESSAGE and resets Manage edits and confirmations', async () => {
    const { deps, state } = setup('manage', {
      run: vi.fn(
        async () => ({ kind: 'error', message: TOKEN_CHANGED_MESSAGE, timeout: false }) as const
      ),
    })
    await flush()
    state.owner.value = SECOND
    state.confirmedOwner.value = SECOND
    state.setMintable(false)
    state.mintOffConfirmed.value = true
    await state.submit()

    expect(deps.tokens.findToken).toHaveBeenCalledTimes(2)
    expect(state.actionError.value?.message).toBe(TOKEN_CHANGED_MESSAGE)
    expect(state.confirmedOwner.value).toBeNull()
    expect(state.mintOffConfirmed.value).toBe(false)
    expect(state.owner.value).toBe(state.facts.value?.owner)
    expect(state.mintable.value).toBe(true)
  })

  it('keeps the typed amount of a mint after TOKEN_CHANGED_MESSAGE', async () => {
    const { deps, state } = setup('mint', {
      run: vi.fn(
        async () => ({ kind: 'error', message: TOKEN_CHANGED_MESSAGE, timeout: false }) as const
      ),
    })
    await flush()
    state.amount.value = '2'
    await state.submit()

    expect(deps.tokens.findToken).toHaveBeenCalledTimes(2)
    expect(state.amount.value).toBe('2')
  })
})

describe('timeout and pending', () => {
  it('keeps busy true after a timeout, flags the error and is not pending elsewhere', async () => {
    const holder: { key: string | null } = { key: null }
    const { state, address, zts } = setup('burn', {
      run: vi.fn(async (key: string) => {
        holder.key = key
        settlePending(key, 'unknown')
        return timeoutResult
      }),
    })
    await flush()
    state.amount.value = '1'
    await state.submit()

    expect(holder.key).toBe(`token-burn:${address}:${zts}`)
    expect(state.actionError.value).toEqual({ message: SEND_TIMEOUT_MESSAGE, timeout: true })
    expect(state.busy.value).toBe(true)
    expect(state.pendingElsewhere.value).toBe(false)
  })

  it('does not call run again after a timeout', async () => {
    const { deps, state } = setup('burn', {
      run: vi.fn(async (key: string) => {
        settlePending(key, 'unknown')
        return timeoutResult
      }),
    })
    await flush()
    state.amount.value = '1'
    await state.submit()
    await state.submit()
    await state.submit()

    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('treats a key claimed before setup as pending elsewhere and never runs', async () => {
    const index = n
    const address = user(10 + index)
    const zts = `zts1token${index}xxxxxxxxxxxx`
    expect(claimPending(`token-burn:${address}:${zts}`)).toBe(true)
    const { deps, state } = setup('burn')
    await flush()
    state.amount.value = '1'

    expect(state.pendingElsewhere.value).toBe(true)
    expect(state.busy.value).toBe(true)
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('keeps a pending mint from blocking a burn of the same token', async () => {
    const index = n
    const address = user(10 + index)
    const zts = `zts1token${index}xxxxxxxxxxxx`
    claimPending(`token-mint:${address}:${zts}`)
    const { deps, state } = setup('burn')
    await flush()
    state.amount.value = '1'
    await state.submit()

    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('builds the key from the account and token for mode manage as update', async () => {
    const { state, address, zts } = setup('manage')
    await flush()
    expect(state.key.value).toBe(`token-update:${address}:${zts}`)
  })
})

describe('burn picker', () => {
  it('lists only held burnable choices and reads the balance of the selected token', async () => {
    const list: BalanceInfo[] = [
      { tokenStandard: 'zts1aaa', balance: '5', decimals: 8, symbol: 'AAA', name: 'A' },
      { tokenStandard: 'zts1zero', balance: '0', decimals: 8, symbol: 'ZZZ', name: 'Z' },
    ]
    const { state } = setup('burn', {
      tokenStandard: null,
      balances: () => ({ list, loading: false }),
    })

    expect(state.choices.value.map((c) => c.tokenStandard)).toEqual(['zts1aaa'])
    state.select('zts1aaa')
    expect(state.balance.value).toBe(5n)
    state.select('zts1missing')
    expect(state.balance.value).toBe(0n)
  })

  it('exposes facts through tokenFacts of the read', async () => {
    const { state, token } = setup('mint')
    await flush()
    expect(state.facts.value).toEqual(tokenFacts(token))
  })
})

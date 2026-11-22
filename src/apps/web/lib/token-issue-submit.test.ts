import { effectScope } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core/composables/useTxTracker', () => ({
  useTrackedTransactions: () => ({ get: () => null }),
  trackRejected: vi.fn(),
}))

import { SEND_TIMEOUT_MESSAGE } from '@/core/transaction-service'
import { TOKEN_ISSUE_FEE } from '@/config'
import { must } from '@/test/must'
import type { ActionResult } from './contract-action'
import { claimPending, settlePending } from '@/shared/lib/pending-calls'
import { issueMeta, parseIssueForm } from './token-issue'
import type { IssueForm } from './token-issue'
import { useIssueSubmit } from './token-issue-submit'
import type { IssueSubmitDeps } from './token-issue-submit'

const validForm: IssueForm = {
  name: 'MyToken',
  symbol: 'myt',
  domain: '',
  decimals: '8',
  totalSupply: '1000',
  maxSupply: '2000',
  mintable: true,
  burnable: true,
  utility: false,
}

let n = 0
function setup(over: Partial<IssueSubmitDeps> = {}, form: IssueForm = validForm) {
  const key = `token-issue:z1test${n++}`
  const deps: IssueSubmitDeps = {
    key,
    address: 'z1me',
    form: () => form,
    znnBalance: () => TOKEN_ISSUE_FEE,
    run: vi.fn(async (): Promise<ActionResult> => ({ kind: 'sent', hash: 'h1' })),
    navigate: vi.fn(async () => undefined),
    ...over,
  }
  const scope = effectScope()
  const state = must(scope.run(() => useIssueSubmit(deps)))
  return { deps, state, key, scope }
}

const timeoutResult = { kind: 'error', message: SEND_TIMEOUT_MESSAGE, timeout: true } as const

describe('submit', () => {
  it('never calls run for an invalid form', async () => {
    const { deps, state } = setup({}, { ...validForm, name: '-bad' })
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
    expect(state.submitting.value).toBe(false)
  })

  it('never calls run for an empty form', async () => {
    const { deps, state } = setup({}, { ...validForm, symbol: '' })
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('never calls run when the ZNN balance is below the fee', async () => {
    const { deps, state } = setup({ znnBalance: () => TOKEN_ISSUE_FEE - 1n })
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.navigate).not.toHaveBeenCalled()
    expect(state.submitting.value).toBe(false)
  })

  it('never calls run while the balance is unknown', async () => {
    const { deps, state } = setup({ znnBalance: () => null })
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('calls run once with the address, the parsed params and the matching meta', async () => {
    const { deps, state } = setup()
    await state.submit()

    const expected = must(parseIssueForm(validForm, TOKEN_ISSUE_FEE).params)
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.run).toHaveBeenCalledWith('z1me', expected, issueMeta(expected))
    expect(expected.symbol).toBe('MYT')
  })

  it('does not call run for a null address', async () => {
    const { deps, state } = setup({ address: null })
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('does not call run again while the first run is unresolved', async () => {
    let finish: (r: ActionResult) => void = () => undefined
    const { deps, state } = setup({
      run: vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve))),
    })
    const first = state.submit()
    await Promise.resolve()
    expect(state.submitting.value).toBe(true)

    await state.submit()
    expect(deps.run).toHaveBeenCalledTimes(1)

    finish({ kind: 'sent', hash: 'h1' })
    await first
    expect(deps.run).toHaveBeenCalledTimes(1)
  })
})

describe('result handling', () => {
  it('navigates to the hash when sent', async () => {
    const { deps, state } = setup()
    await state.submit()
    expect(deps.navigate).toHaveBeenCalledWith('h1')
    expect(state.actionError.value).toBeNull()
    expect(state.submitting.value).toBe(false)
  })

  it('does not navigate after the scope stopped mid-run', async () => {
    let finish: (r: ActionResult) => void = () => undefined
    const { deps, state, scope } = setup({
      run: vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve))),
    })
    const sending = state.submit()
    await Promise.resolve()
    scope.stop()
    finish({ kind: 'sent', hash: 'h1' })
    await sending
    expect(deps.navigate).not.toHaveBeenCalled()
  })

  it('shows a refusal and frees the page for another try', async () => {
    const { deps, state } = setup({
      run: vi.fn(async () => ({ kind: 'error', message: 'refused', timeout: false }) as const),
    })
    await state.submit()
    expect(state.actionError.value).toEqual({ message: 'refused', timeout: false })
    expect(state.busy.value).toBe(false)

    await state.submit()
    expect(deps.run).toHaveBeenCalledTimes(2)
  })

  it('clears the previous error when a new submit starts', async () => {
    const run = vi
      .fn<IssueSubmitDeps['run']>()
      .mockResolvedValueOnce({ kind: 'error', message: 'refused', timeout: false })
      .mockResolvedValueOnce({ kind: 'sent', hash: 'h2' })
    const { state } = setup({ run })
    await state.submit()
    await state.submit()
    expect(state.actionError.value).toBeNull()
  })

  it('does nothing visible when the run is skipped', async () => {
    const { deps, state } = setup({ run: vi.fn(async () => ({ kind: 'skipped' }) as const) })
    await state.submit()
    expect(deps.navigate).not.toHaveBeenCalled()
    expect(state.actionError.value).toBeNull()
    expect(state.busy.value).toBe(false)
  })
})

describe('timeout and pending', () => {
  it('after a timeout, keeps busy true, flags the error and does not call it pending elsewhere', async () => {
    const { key, state } = setup({
      run: vi.fn(async () => {
        settlePending(key, 'unknown')
        return timeoutResult
      }),
    })
    await state.submit()

    expect(state.actionError.value).toEqual({ message: SEND_TIMEOUT_MESSAGE, timeout: true })
    expect(state.busy.value).toBe(true)
    expect(state.pendingElsewhere.value).toBe(false)
  })

  it('after a timeout, a second submit does not call run', async () => {
    const { key, deps, state } = setup({
      run: vi.fn(async () => {
        settlePending(key, 'unknown')
        return timeoutResult
      }),
    })
    await state.submit()
    await state.submit()
    await state.submit()

    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('treats a key claimed before the page started as pending elsewhere', async () => {
    const key = `token-issue:z1claimed${n++}`
    expect(claimPending(key)).toBe(true)
    const { deps, state } = setup({ key })

    expect(state.pendingElsewhere.value).toBe(true)
    expect(state.busy.value).toBe(true)
    await state.submit()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('uses a separate key per account', async () => {
    const claimed = `token-issue:z1other${n++}`
    claimPending(claimed)
    const { deps, state } = setup()
    await state.submit()
    expect(deps.run).toHaveBeenCalledTimes(1)
  })
})

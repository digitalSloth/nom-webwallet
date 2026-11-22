import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { EffectScope } from 'vue'

const wallet = {
  activeWallet: ref<{ baseAddress: string; name: string } | null>({
    baseAddress: 'z1base-a',
    name: 'Wallet A',
  }),
  unlockWallet: vi.fn<(base: string, password: string) => Promise<void>>(async () => {}),
}

const approvals = {
  isBusy: ref(false),
  notice: ref<'accountChanged' | 'needsUnlock' | null>(null),
  needsUnlockPrompt: ref(false),
  currentApproval: ref<{ id: string } | null>({ id: 'ip:1' }),
  approve: vi.fn<(id: string) => Promise<{ kind: 'sendBlock'; hash: string } | null>>(async () => ({
    kind: 'sendBlock',
    hash: 'h1',
  })),
  reject: vi.fn<(id: string) => Promise<void>>(async () => {}),
}

const toastShow = vi.fn()
const toastError = vi.fn(() => 'toast-1')
const toastDismiss = vi.fn()

vi.mock('@/core/composables/useWallet', () => ({ useWallet: () => wallet }))
vi.mock('@/core/composables/useDappApprovals', () => ({ useDappApprovals: () => approvals }))
vi.mock('nom-ui', () => ({
  useToast: () => ({
    show: toastShow,
    toast: { error: toastError, dismiss: toastDismiss },
  }),
}))

const { useApprovalControls } = await import('@/core/composables/useApprovalControls')

let scope: EffectScope

function setup(options?: { onNeedsUnlock?: () => void }) {
  // The rendered id only follows head changes, so the controls are set up
  // with an empty queue and the request arrives afterwards.
  const head = approvals.currentApproval.value
  approvals.currentApproval.value = null
  scope = effectScope()
  const controls = scope.run(() => useApprovalControls(options))!
  approvals.currentApproval.value = head
  return controls
}

// Lets the post-flush head watcher run and starts then expires the cooldown.
async function settleHead(): Promise<void> {
  await nextTick()
  await vi.advanceTimersByTimeAsync(750)
}

beforeEach(() => {
  vi.useFakeTimers()
  wallet.activeWallet.value = { baseAddress: 'z1base-a', name: 'Wallet A' }
  approvals.isBusy.value = false
  approvals.notice.value = null
  approvals.needsUnlockPrompt.value = false
  approvals.currentApproval.value = { id: 'ip:1' }
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useApprovalControls cooldown', () => {
  it('ignores clicks within 750 ms of a head change and accepts them after', async () => {
    const controls = setup()
    await nextTick()

    expect(controls.actionsDisabled.value).toBe(true)
    expect(await controls.handlePrimary()).toBeNull()
    controls.handleReject()
    expect(approvals.approve).not.toHaveBeenCalled()
    expect(approvals.reject).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(749)
    expect(controls.actionsDisabled.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(controls.actionsDisabled.value).toBe(false)

    await controls.handlePrimary()
    expect(approvals.approve).toHaveBeenCalledWith('ip:1')
    controls.handleReject()
    expect(approvals.reject).toHaveBeenCalledWith('ip:1')
  })

  it('disables the actions again for 750 ms when the head is replaced by a re-bound copy', async () => {
    const controls = setup()
    await settleHead()
    expect(controls.actionsDisabled.value).toBe(false)

    approvals.currentApproval.value = { id: 'ip:1' }
    await nextTick()

    expect(controls.actionsDisabled.value).toBe(true)
    await vi.advanceTimersByTimeAsync(749)
    expect(controls.actionsDisabled.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(controls.actionsDisabled.value).toBe(false)
  })

  it('acts on the id that was rendered at the click when the head moves during approve', async () => {
    const controls = setup()
    await settleHead()
    approvals.approve.mockImplementationOnce(async () => {
      approvals.currentApproval.value = { id: 'ip:2' }
      return null
    })

    await controls.handlePrimary()
    expect(approvals.approve).toHaveBeenCalledWith('ip:1')

    // The new head is not yet past its cooldown, so it cannot be hit.
    await nextTick()
    expect(await controls.handlePrimary()).toBeNull()
    expect(approvals.approve).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(750)
    await controls.handlePrimary()
    expect(approvals.approve).toHaveBeenLastCalledWith('ip:2')
  })

  it('acts on the rendered id when the head changes before the screen repaints', async () => {
    const controls = setup()
    await settleHead()

    approvals.currentApproval.value = { id: 'ip:2' }
    const click = controls.handlePrimary()
    controls.handleReject()
    await click

    expect(approvals.approve).toHaveBeenCalledWith('ip:1')
    expect(approvals.reject).toHaveBeenCalledWith('ip:1')
  })

  it('does nothing when no request is rendered', async () => {
    const controls = setup()
    await settleHead()
    approvals.currentApproval.value = null
    await settleHead()

    expect(await controls.handlePrimary()).toBeNull()
    controls.handleReject()
    expect(approvals.approve).not.toHaveBeenCalled()
    expect(approvals.reject).not.toHaveBeenCalled()
  })

  it('restartCooldown blocks clicks for another 750 ms', async () => {
    const controls = setup()
    await settleHead()
    expect(controls.actionsDisabled.value).toBe(false)

    controls.restartCooldown()
    expect(controls.actionsDisabled.value).toBe(true)
    expect(await controls.handlePrimary()).toBeNull()
    await vi.advanceTimersByTimeAsync(749)
    expect(controls.actionsDisabled.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(controls.actionsDisabled.value).toBe(false)
  })

  it('disables the actions while the approval is busy', async () => {
    const controls = setup()
    await settleHead()
    approvals.isBusy.value = true

    expect(controls.actionsDisabled.value).toBe(true)
    expect(await controls.handlePrimary()).toBeNull()
  })
})

describe('useApprovalControls inline unlock', () => {
  beforeEach(() => {
    approvals.needsUnlockPrompt.value = true
  })

  it('unlocks the pinned wallet with the typed password, then approves', async () => {
    const controls = setup()
    await settleHead()
    expect(controls.unlockTarget.value).toEqual({ baseAddress: 'z1base-a', name: 'Wallet A' })

    controls.password.value = 'secret'
    const result = await controls.handlePrimary()

    expect(wallet.unlockWallet).toHaveBeenCalledWith('z1base-a', 'secret')
    expect(approvals.approve).toHaveBeenCalledWith('ip:1')
    expect(result).toEqual({ kind: 'sendBlock', hash: 'h1' })
    expect(controls.password.value).toBe('')
  })

  it('requires a password and neither unlocks nor approves without one', async () => {
    const controls = setup()
    await settleHead()

    expect(await controls.handlePrimary()).toBeNull()

    expect(controls.unlockError.value).toBe('Password is required')
    expect(wallet.unlockWallet).not.toHaveBeenCalled()
    expect(approvals.approve).not.toHaveBeenCalled()
  })

  it('shows the unlock failure and does not approve', async () => {
    const controls = setup()
    await settleHead()
    wallet.unlockWallet.mockRejectedValueOnce(new Error('Wrong password'))
    controls.password.value = 'nope'

    expect(await controls.handlePrimary()).toBeNull()

    expect(controls.unlockError.value).toBe('Wrong password')
    expect(approvals.approve).not.toHaveBeenCalled()
    expect(controls.isUnlocking.value).toBe(false)
  })

  it('clears the error when the password changes', async () => {
    const controls = setup()
    await settleHead()
    await controls.handlePrimary()
    expect(controls.unlockError.value).toBe('Password is required')

    controls.password.value = 'x'
    await nextTick()
    expect(controls.unlockError.value).toBeNull()
  })

  it('clears the password and moves the pin when the active wallet changes', async () => {
    const controls = setup()
    await settleHead()
    controls.password.value = 'secret'

    wallet.activeWallet.value = { baseAddress: 'z1base-b', name: 'Wallet B' }
    await nextTick()

    expect(controls.password.value).toBe('')
    expect(controls.unlockTarget.value).toEqual({ baseAddress: 'z1base-b', name: 'Wallet B' })
    controls.password.value = 'other'
    await controls.handlePrimary()
    expect(wallet.unlockWallet).toHaveBeenCalledWith('z1base-b', 'other')
  })

  it('clears the field when the unlock prompt is no longer needed', async () => {
    const controls = setup()
    await settleHead()
    controls.password.value = 'secret'

    approvals.needsUnlockPrompt.value = false
    await nextTick()

    expect(controls.password.value).toBe('')
  })
})

describe('useApprovalControls notices', () => {
  it('returns the approve result', async () => {
    const controls = setup()
    await settleHead()

    expect(await controls.handlePrimary()).toEqual({ kind: 'sendBlock', hash: 'h1' })
  })

  it('calls onNeedsUnlock once and shows the warning toast on a needsUnlock notice', async () => {
    const onNeedsUnlock = vi.fn()
    const controls = setup({ onNeedsUnlock })
    await settleHead()
    approvals.approve.mockImplementationOnce(async () => {
      approvals.notice.value = 'needsUnlock'
      return null
    })

    expect(await controls.handlePrimary()).toBeNull()

    expect(onNeedsUnlock).toHaveBeenCalledOnce()
    expect(toastShow).toHaveBeenCalledWith('Unlock the wallet to approve this request.', 'warning')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows a sticky error toast on an accountChanged notice and dismisses it on the next click', async () => {
    const controls = setup()
    await settleHead()
    approvals.approve.mockImplementationOnce(async () => {
      approvals.notice.value = 'accountChanged'
      return null
    })

    await controls.handlePrimary()
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining('changed after this request was made'),
      { duration: Infinity, closeButton: true }
    )
    expect(toastShow).not.toHaveBeenCalled()

    controls.handleReject()
    expect(toastDismiss).toHaveBeenCalledWith('toast-1')
  })

  it('shows no toast when approve leaves no notice', async () => {
    const controls = setup()
    await settleHead()
    await controls.handlePrimary()

    expect(toastShow).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })
})

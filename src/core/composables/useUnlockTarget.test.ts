import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const WALLET_A = { baseAddress: 'z1base-a', name: 'Wallet A' }
const WALLET_B = { baseAddress: 'z1base-b', name: 'Wallet B' }

const walletState = { activeWallet: ref<typeof WALLET_A | null>(WALLET_A) }

vi.mock('@/core/composables/useWallet', () => ({ useWallet: () => walletState }))

const { useUnlockTarget } = await import('@/core/composables/useUnlockTarget')

describe('useUnlockTarget', () => {
  it('pins the active wallet when the prompt opens', () => {
    walletState.activeWallet.value = WALLET_A
    const { unlockTarget, pinActiveWallet } = useUnlockTarget(vi.fn())

    pinActiveWallet()

    expect(unlockTarget.value).toEqual(WALLET_A)
  })

  it('keeps the pinned wallet and closes the prompt when the active wallet changes', async () => {
    walletState.activeWallet.value = WALLET_A
    const onTargetChanged = vi.fn()
    const { unlockTarget, pinActiveWallet } = useUnlockTarget(onTargetChanged)
    pinActiveWallet()

    walletState.activeWallet.value = WALLET_B
    await nextTick()

    expect(onTargetChanged).toHaveBeenCalledTimes(1)
    expect(unlockTarget.value).toBeNull()
  })

  it('names the new wallet when the prompt opens again', async () => {
    walletState.activeWallet.value = WALLET_A
    const { unlockTarget, pinActiveWallet } = useUnlockTarget(vi.fn())
    pinActiveWallet()
    walletState.activeWallet.value = WALLET_B
    await nextTick()

    pinActiveWallet()

    expect(unlockTarget.value).toEqual(WALLET_B)
  })

  it('does not close a prompt that was never opened', async () => {
    walletState.activeWallet.value = WALLET_A
    const onTargetChanged = vi.fn()
    useUnlockTarget(onTargetChanged)

    walletState.activeWallet.value = WALLET_B
    await nextTick()

    expect(onTargetChanged).not.toHaveBeenCalled()
  })
})

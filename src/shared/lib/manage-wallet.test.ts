import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { canManage, manageRouteMustLeave, type ManageState } from './manage-wallet'

const A = 'z1qaaa'
const B = 'z1qbbb'

function state(unlocked: string[]): ManageState {
  return {
    wallets: ref([{ baseAddress: A }, { baseAddress: B }]),
    unlockedWallets: ref(unlocked),
    refreshLockState: vi.fn(),
  } as unknown as ManageState
}

describe('canManage', () => {
  it('refuses a locked or unknown wallet and allows an unlocked one', () => {
    const s = state([A])
    expect(canManage(s, A)).toBe(true)
    expect(canManage(s, B)).toBe(false)
    expect(canManage(s, 'z1qzzz')).toBe(false)
  })

  it('applies session expiry before it checks', () => {
    const s = state([A])
    canManage(s, A)
    expect(s.refreshLockState).toHaveBeenCalled()
  })
})

describe('manageRouteMustLeave', () => {
  it('leaves when another wallet is active and the managed one is locked', () => {
    expect(manageRouteMustLeave(state([A]), B, A)).toBe(true)
    expect(manageRouteMustLeave(state([]), B, null)).toBe(true)
  })

  it('stays while the managed wallet is the one the lock gate asks for', () => {
    expect(manageRouteMustLeave(state([A]), B, B)).toBe(false)
  })

  it('stays when the managed wallet is unlocked or not stored', () => {
    expect(manageRouteMustLeave(state([A, B]), B, A)).toBe(false)
    expect(manageRouteMustLeave(state([A]), 'z1qzzz', A)).toBe(false)
  })
})

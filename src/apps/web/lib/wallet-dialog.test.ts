import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type Ref } from 'vue'

import { canManage, useWalletDialog, type ManageState } from './wallet-dialog'

const A = 'z1qaaa'
const B = 'z1qbbb'
const GONE = 'z1qzzz'

let wallets: Ref<{ baseAddress: string }[]>
let unlocked: Ref<string[]>
let refreshLockState: ReturnType<typeof vi.fn>
let state: ManageState

beforeEach(() => {
  wallets = ref([{ baseAddress: A }, { baseAddress: B }])
  unlocked = ref([A])
  refreshLockState = vi.fn()
  state = { wallets, unlockedWallets: unlocked, refreshLockState } as unknown as ManageState
})

function setup() {
  const scope = effectScope()
  const result = scope.run(() => useWalletDialog(state))
  if (!result) throw new Error('scope is inactive')
  return result
}

describe('canManage', () => {
  it('is true for a stored unlocked wallet', () => {
    expect(canManage(state, A)).toBe(true)
  })

  it('is false for a locked or unknown wallet', () => {
    expect(canManage(state, B)).toBe(false)
    expect(canManage(state, GONE)).toBe(false)
  })

  it('is false for an unlocked address that is not stored', () => {
    unlocked.value = [A, GONE]

    expect(canManage(state, GONE)).toBe(false)
  })

  it('refreshes the lock state before reading it', () => {
    refreshLockState.mockImplementation(() => {
      unlocked.value = []
    })

    expect(canManage(state, A)).toBe(false)
    expect(refreshLockState).toHaveBeenCalledTimes(1)
  })
})

describe('useWalletDialog show', () => {
  it.each(['export', 'password', 'remove'] as const)('opens %s for an unlocked wallet', (kind) => {
    const d = setup()

    expect(d.show(kind, A)).toBe(true)
    expect(d.dialog.value).toEqual({ kind, address: A })
  })

  it.each(['export', 'password', 'remove'] as const)('refuses %s for a locked wallet', (kind) => {
    const d = setup()

    expect(d.show(kind, B)).toBe(false)
    expect(d.dialog.value).toBeNull()
  })

  it.each(['export', 'password', 'remove', 'unlock'] as const)(
    'refuses %s for an unknown wallet',
    (kind) => {
      const d = setup()

      expect(d.show(kind, GONE)).toBe(false)
      expect(d.dialog.value).toBeNull()
    }
  )

  it('opens unlock for a locked wallet and refuses it for an unlocked one', () => {
    const d = setup()

    expect(d.show('unlock', A)).toBe(false)
    expect(d.show('unlock', B)).toBe(true)
    expect(d.dialog.value).toEqual({ kind: 'unlock', address: B })
  })

  it('returns false and keeps the open dialog while one is open', () => {
    const d = setup()
    d.show('export', A)

    expect(d.show('unlock', B)).toBe(false)
    expect(d.dialog.value).toEqual({ kind: 'export', address: A })
  })

  it('opens again after close', () => {
    const d = setup()
    d.show('export', A)
    d.close()

    expect(d.dialog.value).toBeNull()
    expect(d.show('password', A)).toBe(true)
  })

  it('applies expiry before deciding', () => {
    refreshLockState.mockImplementation(() => {
      unlocked.value = []
    })
    const d = setup()

    expect(d.show('export', A)).toBe(false)
    expect(refreshLockState).toHaveBeenCalled()
  })
})

describe('useWalletDialog closing', () => {
  it.each(['export', 'password', 'remove'] as const)(
    'closes %s synchronously when its wallet locks',
    (kind) => {
      const d = setup()
      d.show(kind, A)

      unlocked.value = []

      expect(d.dialog.value).toBeNull()
    }
  )

  it.each(['export', 'password', 'remove'] as const)(
    'closes %s when its wallet is removed',
    (kind) => {
      const d = setup()
      d.show(kind, A)

      wallets.value = [{ baseAddress: B }]

      expect(d.dialog.value).toBeNull()
    }
  )

  it('closes an unlock dialog when its wallet is removed', () => {
    const d = setup()
    d.show('unlock', B)

    wallets.value = [{ baseAddress: A }]

    expect(d.dialog.value).toBeNull()
  })

  it('closes an unlock dialog when its wallet unlocks', () => {
    const d = setup()
    d.show('unlock', B)

    unlocked.value = [A, B]

    expect(d.dialog.value).toBeNull()
  })

  it('keeps the dialog open when an unrelated wallet locks', () => {
    unlocked.value = [A, B]
    const d = setup()
    d.show('export', A)

    unlocked.value = [A]

    expect(d.dialog.value).toEqual({ kind: 'export', address: A })
  })

  it('keeps an unlock dialog open when an unrelated wallet unlocks', () => {
    wallets.value = [{ baseAddress: A }, { baseAddress: B }, { baseAddress: 'z1qccc' }]
    const d = setup()
    d.show('unlock', B)

    unlocked.value = [A, 'z1qccc']

    expect(d.dialog.value).toEqual({ kind: 'unlock', address: B })
  })

  it('closes on in-place mutation of the unlocked list', () => {
    const d = setup()
    d.show('export', A)

    unlocked.value.pop()

    expect(d.dialog.value).toBeNull()
  })
})

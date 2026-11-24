import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope } from 'vue'

import { LOCK_CHECK_MS } from '@/config'

const wallet = vi.hoisted(() => ({
  hasWallets: { value: false },
  activeWallet: { value: null as null | object },
  isActiveWalletUnlocked: { value: false },
  refreshLockState: vi.fn(),
  loadWalletData: vi.fn(async () => true),
}))
const session = vi.hoisted(() => ({
  noteActivity: vi.fn(),
  unsubscribe: vi.fn(),
  listener: null as null | ((change: 'lock' | 'wallets') => void),
}))

vi.mock('@/core', () => ({ useWallet: () => wallet }))
vi.mock('@/core/web-session', () => ({
  noteActivity: session.noteActivity,
  onWebSessionChange: (listener: (change: 'lock' | 'wallets') => void) => {
    session.listener = listener
    return session.unsubscribe
  },
}))

// Vue is imported above, before `document` is stubbed (it touches it at import).
const { useWebSession } = await import('./useWebSession')

let win: EventTarget
let doc: EventTarget
let scope: EffectScope

function setup() {
  scope = effectScope()
  const result = scope.run(() => useWebSession())
  if (!result) throw new Error('scope is inactive')
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  win = new EventTarget()
  doc = new EventTarget()
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', doc)
  wallet.hasWallets = ref(false) as never
  wallet.isActiveWalletUnlocked = ref(false) as never
  wallet.activeWallet = ref(null) as never
  vi.clearAllMocks()
  session.listener = null
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useWebSession locked', () => {
  it.each([
    ['wallets and the active wallet locked', true, {}, false, true],
    ['wallets and no active wallet', true, null, false, true],
    ['no wallets', false, null, false, false],
    ['the active wallet unlocked', true, {}, true, false],
  ])('is correct for %s', (_name, hasWallets, active, unlocked, expected) => {
    wallet.hasWallets.value = hasWallets
    wallet.activeWallet.value = active
    wallet.isActiveWalletUnlocked.value = unlocked

    const { locked } = setup()

    expect(locked.value).toBe(expected)
  })

  it('follows the wallet state', () => {
    wallet.hasWallets.value = true
    const { locked } = setup()
    expect(locked.value).toBe(true)

    wallet.isActiveWalletUnlocked.value = true

    expect(locked.value).toBe(false)
  })
})

describe('useWebSession wiring', () => {
  it.each(['pointerdown', 'keydown'])('%s notes activity then refreshes the lock state', (type) => {
    setup()
    const order: string[] = []
    session.noteActivity.mockImplementation(() => order.push('note'))
    wallet.refreshLockState.mockImplementation(() => order.push('refresh'))

    win.dispatchEvent(new Event(type))

    expect(order).toEqual(['note', 'refresh'])
  })

  it('refreshes the lock state on a lock change', () => {
    setup()

    session.listener?.('lock')

    expect(wallet.refreshLockState).toHaveBeenCalledTimes(1)
    expect(wallet.loadWalletData).not.toHaveBeenCalled()
  })

  it('reloads wallet data on a wallets change', () => {
    setup()

    session.listener?.('wallets')

    expect(wallet.loadWalletData).toHaveBeenCalledTimes(1)
    expect(wallet.refreshLockState).not.toHaveBeenCalled()
  })

  it('refreshes every check interval with no input', () => {
    setup()

    vi.advanceTimersByTime(LOCK_CHECK_MS * 3)

    expect(wallet.refreshLockState).toHaveBeenCalledTimes(3)
    expect(session.noteActivity).not.toHaveBeenCalled()
  })

  it('refreshes on visibilitychange', () => {
    setup()

    doc.dispatchEvent(new Event('visibilitychange'))

    expect(wallet.refreshLockState).toHaveBeenCalledTimes(1)
  })

  it('removes listeners, the interval and the subscription when the scope stops', () => {
    setup()

    scope.stop()
    win.dispatchEvent(new Event('pointerdown'))
    win.dispatchEvent(new Event('keydown'))
    doc.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(LOCK_CHECK_MS * 3)

    expect(session.noteActivity).not.toHaveBeenCalled()
    expect(wallet.refreshLockState).not.toHaveBeenCalled()
    expect(session.unsubscribe).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

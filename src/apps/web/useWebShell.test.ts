import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive, ref, type EffectScope } from 'vue'

const phone = ref(false)
const params = reactive<{ address?: string }>({})
const replace = vi.fn()
const show = vi.fn()
const route = { params, name: 'pillars', matched: [{ components: { large: {} } }] } as {
  params: { address?: string }
  name: string
  matched: { components: Record<string, unknown> }[]
}
const provideWebHost = vi.fn()
const held = ref(false)
const activeWallet = ref<{ baseAddress: string } | null>(null)
const unlockedWallets = ref<string[]>([])
const wallets = ref<{ baseAddress: string }[]>([])

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
vi.mock('nom-ui', () => ({
  useTheme: () => ({ initTheme: vi.fn() }),
  useToast: () => ({ show }),
}))
vi.mock('@/config', () => ({ WALLETCONNECT_ENABLED: false }))
vi.mock('@/core', () => ({
  onTxProgress: vi.fn(),
  resumeTracking: vi.fn(),
  startAutoReceive: () => () => {},
  startInterruptedChecks: vi.fn(),
  useAccount: () => ({ loadAccountData: vi.fn() }),
  useNetwork: () => ({ initialize: vi.fn() }),
  useWallet: () => ({
    activeWallet,
    unlockedWallets,
    wallets,
    refreshLockState: vi.fn(),
    activeAccountAddress: ref(null),
    hasWallets: ref(true),
    ensureLoaded: vi.fn(),
    loadWalletData: vi.fn(),
  }),
  useWalletConnect: () => ({ initialize: vi.fn() }),
}))
vi.mock('./breakpoint', () => ({ usePhoneLayout: () => phone }))
vi.mock('./layout-hold', () => ({ layoutHeld: held }))
vi.mock('./small-host', () => ({ provideWebHost }))

const { useWebShell } = await import('./useWebShell')

let scope: EffectScope

beforeEach(() => {
  phone.value = false
  held.value = false
  params.address = undefined
  activeWallet.value = null
  unlockedWallets.value = []
  wallets.value = []
  route.name = 'pillars'
  route.matched = [{ components: { large: {} } }]
  replace.mockClear()
  show.mockClear()
  scope = effectScope()
  scope.run(() => useWebShell())
})

afterEach(() => {
  scope.stop()
})

describe('useWebShell layout watcher', () => {
  it('provides the web host with the router', () => {
    expect(provideWebHost).toHaveBeenCalledWith({ replace })
  })

  it('does nothing until the width crosses 900 px', () => {
    expect(replace).not.toHaveBeenCalled()
  })

  it('moves a large-only page to Home with the notice when the width shrinks to phone', async () => {
    phone.value = true
    await Promise.resolve()

    expect(show).toHaveBeenCalledWith('Pillars, staking and tokens need a wider screen.', 'info')
    expect(replace).toHaveBeenCalledWith({ name: 'home' })
  })

  it('moves Activity to the Home Activity tab with no notice', async () => {
    route.name = 'activity'
    phone.value = true
    await Promise.resolve()

    expect(show).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledWith({ name: 'home', query: { tab: 'activity' } })
  })

  it('moves a small-only page to its large page when the width grows', async () => {
    phone.value = true
    await Promise.resolve()
    replace.mockClear()
    show.mockClear()
    route.name = 'send-review'
    route.matched = [{ components: { small: {} } }]

    phone.value = false
    await Promise.resolve()

    expect(replace).toHaveBeenCalledWith({ name: 'send' })
    expect(show).not.toHaveBeenCalled()
  })

  it('stays put when the route has a view in both layouts', async () => {
    route.name = 'home'
    route.matched = [{ components: { small: {}, large: {} } }]

    phone.value = true
    await Promise.resolve()

    expect(replace).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })
})

describe('useWebShell layout hold', () => {
  it('waits for the release before moving off a page the new layout lacks', async () => {
    held.value = true
    phone.value = true
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()

    held.value = false
    await Promise.resolve()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('does not move on release when the route has a view in the layout', async () => {
    route.name = 'home'
    route.matched = [{ components: { small: {}, large: {} } }]
    held.value = true
    phone.value = true
    await Promise.resolve()

    held.value = false
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('useWebShell manage page lock check', () => {
  const A = 'z1qaaa'
  const B = 'z1qbbb'

  beforeEach(async () => {
    wallets.value = [{ baseAddress: A }, { baseAddress: B }]
    unlockedWallets.value = [A]
    activeWallet.value = { baseAddress: B }
    params.address = B
    await Promise.resolve()
    replace.mockClear()
  })

  it('leaves when another wallet is picked in the unlock overlay', async () => {
    activeWallet.value = { baseAddress: A }
    await Promise.resolve()
    expect(replace).toHaveBeenCalledWith({ name: 'settings-wallets' })
  })

  it('leaves when the managed wallet locks while another is active', async () => {
    unlockedWallets.value = [A, B]
    activeWallet.value = { baseAddress: A }
    await Promise.resolve()
    replace.mockClear()

    unlockedWallets.value = [A]
    await Promise.resolve()
    expect(replace).toHaveBeenCalledWith({ name: 'settings-wallets' })
  })

  it('stays while the managed wallet is the one the overlay unlocks', async () => {
    unlockedWallets.value = []
    await Promise.resolve()
    expect(replace).not.toHaveBeenCalled()
  })
})

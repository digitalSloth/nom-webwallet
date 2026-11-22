import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createMemoryHistory } from 'vue-router'

const walletState = {
  ensureLoaded: vi.fn(async () => {}),
  hasWallets: ref(true),
  isActiveWalletUnlocked: ref(true),
  wallets: ref([{ baseAddress: 'z1known' }]),
  unlockedWallets: ref(['z1known']),
}

vi.mock('@/core', () => ({ useWallet: () => walletState }))

const stub = { default: { render: () => null } }
vi.mock('@/apps/small/pages/Home.vue', () => stub)
vi.mock('./pages/WalletConnectWindow.vue', () => stub)
vi.mock('@/apps/small/pages/Send.vue', () => stub)
vi.mock('@/apps/small/pages/SendReview.vue', () => stub)
vi.mock('@/apps/small/pages/Receive.vue', () => stub)
vi.mock('@/apps/small/pages/TokenDetails.vue', () => stub)
vi.mock('@/apps/small/pages/TxTracker.vue', () => stub)
vi.mock('@/apps/small/pages/TxInterrupted.vue', () => stub)
vi.mock('@/apps/small/pages/Plasma.vue', () => stub)
vi.mock('@/apps/small/pages/Rewards.vue', () => stub)
vi.mock('@/apps/small/pages/Settings.vue', () => stub)
vi.mock('@/apps/small/pages/Security.vue', () => stub)
vi.mock('@/apps/small/pages/Network.vue', () => stub)
vi.mock('@/apps/small/pages/ConnectedSites.vue', () => stub)
vi.mock('@/apps/small/pages/WalletSelector.vue', () => stub)
vi.mock('@/apps/small/pages/ManageWallet.vue', () => stub)
vi.mock('@/apps/small/pages/ExportPhrase.vue', () => stub)
vi.mock('@/apps/small/pages/ChangePassword.vue', () => stub)
vi.mock('@/apps/small/pages/RemoveWallet.vue', () => stub)
vi.mock('@/apps/small/pages/Welcome.vue', () => stub)
vi.mock('@/apps/small/pages/CreatePassword.vue', () => stub)
vi.mock('@/apps/small/pages/CreatePhrase.vue', () => stub)
vi.mock('@/apps/small/pages/CreateVerify.vue', () => stub)
vi.mock('@/apps/small/pages/ImportPhrase.vue', () => stub)
vi.mock('./pages/Locked.vue', () => stub)

import { createExtensionRouter } from './routes'
import {
  lockedRedirect,
  leaveAllowed,
  lockedRouteFor,
  managesOtherWallet,
  smallRoutes,
} from '@/apps/small/routes'
import {
  clearSetupDraft,
  ensureCreateMnemonic,
  getSetupDraft,
  setCreatePassword,
} from '@/shared/lib/create-draft'
import { sendDraft } from '@/shared/lib/send-draft'

async function navigate(path: string) {
  const router = createExtensionRouter(createMemoryHistory())
  await router.push(path)
  return router.currentRoute.value
}

beforeEach(() => {
  sendDraft.value = null
  clearSetupDraft()
  walletState.hasWallets.value = true
  walletState.isActiveWalletUnlocked.value = true
  walletState.unlockedWallets.value = ['z1known']
})

describe('extension router guard', () => {
  it('sends a user without a wallet to setup', async () => {
    walletState.hasWallets.value = false

    const route = await navigate('/')

    expect(route.name).toBe('welcome')
  })

  it('opens welcome for a user with wallets', async () => {
    const route = await navigate('/welcome')

    expect(route.name).toBe('welcome')
  })

  it('redirects a locked user on /send to the locked screen', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/send')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/send')
  })

  it('allows /send when unlocked', async () => {
    expect((await navigate('/send')).name).toBe('send')
  })

  it.each(['/nope'])('redirects %s to home', async (path) => {
    expect((await navigate(path)).path).toBe('/')
  })

  it('names /walletconnect and renders it without the popup frame', () => {
    const router = createExtensionRouter(createMemoryHistory())
    const resolved = router.resolve('/walletconnect')

    expect(resolved.name).toBe('walletconnect')
    expect(resolved.meta.layout).toBe('bare')
  })
})

describe('extension router send and tracker routes', () => {
  const draft = {
    recipient: 'z1to',
    amount: '1',
    tokenStandard: 'zts1znn',
    symbol: 'ZNN',
    decimals: 8,
  }

  it('lands /send/review on send when there is no draft', async () => {
    expect((await navigate('/send/review')).name).toBe('send')
  })

  it('lands /send/review on send-review when there is a draft', async () => {
    sendDraft.value = draft as never

    expect((await navigate('/send/review')).name).toBe('send-review')
  })

  it('redirects a locked /send/review to the locked screen', async () => {
    walletState.isActiveWalletUnlocked.value = false
    sendDraft.value = draft as never

    const route = await navigate('/send/review')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/send/review')
  })

  it('resolves /tx/abc to tx with the hash param', async () => {
    const route = await navigate('/tx/abc')

    expect(route.name).toBe('tx')
    expect(route.params.hash).toBe('abc')
  })

  it('resolves a token path to token with the tokenStandard param', async () => {
    const route = await navigate('/token/zts1znnxxxxxxxxxxxxx9z4ulx')

    expect(route.name).toBe('token')
    expect(route.params.tokenStandard).toBe('zts1znnxxxxxxxxxxxxx9z4ulx')
  })

  it('sends a token path to the locked screen while locked', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/token/zts1znnxxxxxxxxxxxxx9z4ulx')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/token/zts1znnxxxxxxxxxxxxx9z4ulx')
  })

  it('resolves /interrupted to interrupted', async () => {
    expect((await navigate('/interrupted')).name).toBe('interrupted')
  })

  it.each(['/receive', '/tx/abc', '/interrupted'])(
    'sends %s to the locked screen while locked',
    async (path) => {
      walletState.isActiveWalletUnlocked.value = false

      const route = await navigate(path)

      expect(route.name).toBe('locked')
      expect(route.query.redirect).toBe(path)
    }
  )

  it('resolves /plasma to plasma when unlocked', async () => {
    expect((await navigate('/plasma')).name).toBe('plasma')
  })

  it('sends /plasma to the locked screen while locked', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/plasma')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/plasma')
  })
})

describe('extension router rewards route', () => {
  it('opens /rewards as rewards while unlocked', async () => {
    expect((await navigate('/rewards')).name).toBe('rewards')
  })

  it('sends /rewards to the locked screen while locked', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/rewards')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/rewards')
  })

  it('shows the tab bar on home, send, receive, rewards and settings only', () => {
    const names = smallRoutes
      .filter((r) => r.meta?.tabBar === true)
      .map((r) => String(r.name))
      .sort()

    expect(names).toEqual(['home', 'receive', 'rewards', 'send', 'settings'])
  })
})

describe('extension router wallet management routes', () => {
  it.each([
    ['/settings', 'settings'],
    ['/settings/security', 'settings-security'],
    ['/settings/network', 'settings-network'],
    ['/apps', 'apps'],
    ['/settings/wallets', 'settings-wallets'],
  ])('sends %s to the locked screen while locked', async (path) => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate(path)

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe(path)
  })

  it.each([
    ['/settings/wallets/z1known', 'manage-wallet'],
    ['/settings/wallets/z1known/export', 'export-phrase'],
    ['/settings/wallets/z1known/password', 'change-password'],
    ['/settings/wallets/z1known/remove', 'remove-wallet'],
  ])('opens %s with the address param', async (path, name) => {
    const route = await navigate(path)

    expect(route.name).toBe(name)
    expect(route.params.address).toBe('z1known')
  })

  it.each(['', '/export', '/password', '/remove'])(
    'sends a locked target wallet at /settings/wallets/z1known%s to the locked screen',
    async (suffix) => {
      walletState.unlockedWallets.value = []

      const route = await navigate(`/settings/wallets/z1known${suffix}`)

      expect(route.name).toBe('locked')
      expect(route.query.redirect).toBe(`/settings/wallets/z1known${suffix}`)
      expect(route.query.wallet).toBe('z1known')
    }
  )

  it('sends a locked target wallet to the locked screen when the active wallet is unlocked', async () => {
    walletState.unlockedWallets.value = ['z1other']

    const route = await navigate('/settings/wallets/z1known')

    expect(route.name).toBe('locked')
    expect(route.query.wallet).toBe('z1known')
  })

  it.each(['', '/export', '/password', '/remove'])(
    'sends an unknown wallet at /settings/wallets/<unknown>%s to the selector',
    async (suffix) => {
      expect((await navigate(`/settings/wallets/z1unknown${suffix}`)).name).toBe('settings-wallets')
    }
  )

  it('sends a user without a wallet from /settings to setup', async () => {
    walletState.hasWallets.value = false

    expect((await navigate('/settings')).name).toBe('welcome')
  })
})

describe('extension router locked screen and first-run routes', () => {
  it('sends a locked / to the locked screen with redirect /', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/')

    expect(route.name).toBe('locked')
    expect(route.query.redirect).toBe('/')
  })

  it('keeps the full path with its query in the redirect', async () => {
    walletState.isActiveWalletUnlocked.value = false

    const route = await navigate('/tx/abc?x=1')

    expect(route.query.redirect).toBe('/tx/abc?x=1')
  })

  it('opens /locked while locked', async () => {
    walletState.isActiveWalletUnlocked.value = false

    expect((await navigate('/locked')).name).toBe('locked')
  })

  it('opens /locked while unlocked', async () => {
    expect((await navigate('/locked')).name).toBe('locked')
  })

  it('sends /locked with no wallets to welcome', async () => {
    walletState.hasWallets.value = false

    expect((await navigate('/locked')).name).toBe('welcome')
  })

  it.each([
    ['/welcome', 'welcome'],
    ['/create/password', 'create-password'],
    ['/import', 'import-phrase'],
  ])('opens %s with wallets, without wallets and while locked', async (path, name) => {
    expect((await navigate(path)).name).toBe(name)

    walletState.hasWallets.value = false
    expect((await navigate(path)).name).toBe(name)

    walletState.hasWallets.value = true
    walletState.isActiveWalletUnlocked.value = false
    expect((await navigate(path)).name).toBe(name)
  })

  it('opens /walletconnect while locked', async () => {
    walletState.isActiveWalletUnlocked.value = false

    expect((await navigate('/walletconnect')).name).toBe('walletconnect')
  })

  it('redirects /setup to home', async () => {
    expect((await navigate('/setup')).name).toBe('home')
  })

  it('sends /create/phrase with no draft to create-password', async () => {
    expect((await navigate('/create/phrase')).name).toBe('create-password')
  })

  it('sends /create/verify with no draft to create-password', async () => {
    expect((await navigate('/create/verify')).name).toBe('create-password')
  })

  it('sends /create/verify with a create draft but no phrase to create-phrase', async () => {
    setCreatePassword('Main', 'pw')

    expect((await navigate('/create/verify')).name).toBe('create-phrase')
  })

  it('opens /create/phrase and /create/verify once the draft has a phrase', async () => {
    setCreatePassword('Main', 'pw')
    ensureCreateMnemonic()

    const router = createExtensionRouter(createMemoryHistory())
    await router.push('/create/phrase')
    expect(router.currentRoute.value.name).toBe('create-phrase')
    await router.push('/create/verify')
    expect(router.currentRoute.value.name).toBe('create-verify')
  })

  it('sends /import/password with no draft to import-phrase', async () => {
    expect((await navigate('/import/password')).name).toBe('import-phrase')
  })

  it('sends /import/password with a create draft to import-phrase', async () => {
    setCreatePassword('Main', 'pw')

    expect((await navigate('/import/password')).name).toBe('import-phrase')
  })

  it('clears a create draft when navigating to home', async () => {
    setCreatePassword('Main', 'pw')
    expect(getSetupDraft()).not.toBeNull()

    await navigate('/')

    expect(getSetupDraft()).toBeNull()
  })

  it('keeps a create draft while moving between create routes', async () => {
    setCreatePassword('Main', 'pw')
    ensureCreateMnemonic()
    const router = createExtensionRouter(createMemoryHistory())

    await router.push('/create/phrase')
    await router.push('/create/verify')

    expect(getSetupDraft()).not.toBeNull()
  })
})

describe('lockedRedirect', () => {
  it.each<[unknown, string]>([
    ['/send', '/send'],
    ['/tx/abc?x=1', '/tx/abc?x=1'],
    [undefined, '/'],
    [null, '/'],
    [['/send'], '/'],
    ['', '/'],
    ['//evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['/locked?redirect=/send', '/'],
    ['/locked', '/'],
  ])('maps %j to %s', (input, expected) => {
    expect(lockedRedirect(input)).toBe(expected)
  })
})

describe('lockedRouteFor', () => {
  const manage = (address: string) => ({
    meta: { requiresUnlock: true },
    params: { address },
    fullPath: `/settings/wallets/${address}`,
  })
  const lockState = (active: boolean, unlocked: string[]) =>
    ({
      wallets: ref([{ baseAddress: 'z1known' }, { baseAddress: 'z1other' }]),
      unlockedWallets: ref(unlocked),
      isActiveWalletUnlocked: ref(active),
    }) as never

  it('returns null for a page that needs no unlock', () => {
    const to = { meta: {}, params: {}, fullPath: '/welcome' }

    expect(lockedRouteFor(to, lockState(false, []))).toBeNull()
  })

  it('returns null when the active and the target wallet are unlocked', () => {
    expect(lockedRouteFor(manage('z1known'), lockState(true, ['z1known']))).toBeNull()
  })

  it('names the target wallet when only the active wallet is unlocked', () => {
    expect(lockedRouteFor(manage('z1known'), lockState(true, ['z1other']))).toEqual({
      name: 'locked',
      query: { redirect: '/settings/wallets/z1known', wallet: 'z1known' },
    })
  })

  it('leaves an unknown target to the wallet selector', () => {
    expect(lockedRouteFor(manage('z1unknown'), lockState(true, []))).toBeNull()
  })
})

describe('extension router canonical paths', () => {
  it.each([
    ['/settings', 'settings'],
    ['/settings/security', 'settings-security'],
    ['/settings/network', 'settings-network'],
    ['/apps', 'apps'],
    ['/settings/wallets', 'settings-wallets'],
  ])('opens %s as %s while unlocked', async (path, name) => {
    expect((await navigate(path)).name).toBe(name)
  })

  it.each(['/wallets', '/wallets/z1known', '/sites', '/security', '/network'])(
    'sends the retired path %s home',
    async (path) => {
      expect((await navigate(path)).path).toBe('/')
    }
  )

  it('builds the extension router from smallRoutes plus locked and walletconnect', () => {
    const router = createExtensionRouter(createMemoryHistory())

    for (const record of smallRoutes) {
      expect(record.name).not.toBe('locked')
      expect(record.name).not.toBe('walletconnect')
      expect(record.path).not.toBe('/:pathMatch(.*)*')
    }
    expect(router.hasRoute('locked')).toBe(true)
    expect(router.hasRoute('walletconnect')).toBe(true)
  })
})

describe('managesOtherWallet', () => {
  it.each([
    ['/settings/wallets/z1other', true],
    ['/settings/wallets/z1other/export', true],
    ['/settings/wallets/z1known', false],
    ['/settings/wallets/z1known/remove', false],
    ['/settings/wallets', false],
    ['/', false],
  ])('judges the redirect %s as %s for z1known', (redirect, expected) => {
    expect(managesOtherWallet(redirect, 'z1known')).toBe(expected)
  })
})

describe('extension router navigation targets', () => {
  const targets: Record<string, Record<string, string>> = {
    home: {},
    send: {},
    'send-review': {},
    receive: {},
    token: { tokenStandard: 'zts1' },
    tx: { hash: 'abc' },
    plasma: {},
    rewards: {},
    settings: {},
    'settings-security': {},
    'settings-network': {},
    apps: {},
    'settings-wallets': {},
    'manage-wallet': { address: 'z1known' },
    'export-phrase': { address: 'z1known' },
    'change-password': { address: 'z1known' },
    'remove-wallet': { address: 'z1known' },
    welcome: {},
    'create-password': {},
    'create-phrase': {},
    'create-verify': {},
    'import-phrase': {},
    'import-password': {},
    locked: {},
    interrupted: {},
  }

  it.each(Object.keys(targets))('resolves the route name %s', (name) => {
    const router = createExtensionRouter(createMemoryHistory())

    expect(router.hasRoute(name)).toBe(true)
    expect(router.resolve({ name, params: targets[name] }).name).toBe(name)
  })

  it.each(['wallets', 'manage', 'sites', 'security', 'network', 'export', 'password', 'remove'])(
    'has no route named %s',
    (name) => {
      expect(createExtensionRouter(createMemoryHistory()).hasRoute(name)).toBe(false)
    }
  )
})

describe('leaveAllowed', () => {
  it('allows every route while idle', () => {
    expect(leaveAllowed(false, { name: 'home' })).toBe(true)
  })

  it.each(['home', 'send', 'settings-network'])('blocks %s while busy', (name) => {
    expect(leaveAllowed(true, { name })).toBe(false)
  })

  it('allows the locked screen while busy', () => {
    expect(leaveAllowed(true, { name: 'locked' })).toBe(true)
  })
})

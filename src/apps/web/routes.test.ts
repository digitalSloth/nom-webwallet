import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { ref } from 'vue'
import { sendDraft } from '@/shared/lib/send-draft'

import {
  ensureCreateMnemonic,
  getSetupDraft,
  setCreatePassword,
  startImportDraft,
  clearSetupDraft,
} from '@/shared/lib/create-draft'

const wallet = vi.hoisted(() => ({
  hasWallets: { value: false },
  ensureLoaded: vi.fn(async () => {}),
  wallets: { value: [{ baseAddress: 'z1known' }, { baseAddress: 'z1other' }] },
  unlockedWallets: { value: ['z1known'] as string[] },
  activeWallet: { value: { baseAddress: 'z1known' } as { baseAddress: string } | null },
  setActiveWallet: vi.fn<(address: string) => Promise<void>>(async () => {}),
}))
const show = vi.hoisted(() => vi.fn())

vi.mock('@/core', () => ({ useWallet: () => wallet }))
vi.mock('nom-ui', () => ({ useToast: () => ({ show }) }))

for (const page of [
  'Send',
  'Receive',
  'TxTracker',
  'Plasma',
  'Rewards',
  'Pillars',
  'Staking',
  'Tokens',
  'TokenIssue',
  'Dashboard',
  'Activity',
  'TokenDetails',
  'ConnectedApps',
  'SmallConnectedApps',
]) {
  vi.doMock(`./pages/${page}.vue`, () => ({ default: { name: page } }))
}

for (const page of ['Welcome', 'CreatePassword', 'CreatePhrase', 'CreateVerify', 'ImportPhrase']) {
  vi.doMock(`./pages/onboarding/${page}.vue`, () => ({ default: {} }))
}

for (const page of ['SettingsLayout', 'Wallets', 'Security', 'Network']) {
  vi.doMock(`./pages/settings/${page}.vue`, () => ({ default: {} }))
}

for (const page of [
  'Home',
  'Send',
  'SendReview',
  'Receive',
  'TokenDetails',
  'TxTracker',
  'TxInterrupted',
  'Plasma',
  'Rewards',
  'Settings',
  'Security',
  'Network',
  'ConnectedSites',
  'WalletSelector',
  'ManageWallet',
  'ExportPhrase',
  'ChangePassword',
  'RemoveWallet',
  'Welcome',
  'CreatePassword',
  'CreatePhrase',
  'CreateVerify',
  'ImportPhrase',
]) {
  vi.doMock(`@/apps/small/pages/${page}.vue`, () => ({ default: { name: `Small${page}` } }))
}

let phone = false
vi.doMock('./breakpoint', () => ({ isPhoneLayout: () => phone }))

const { createWebRouter } = await import('./routes')
const { smallRoutes } = await import('@/apps/small/routes')

async function navigate(path: string) {
  const router = createWebRouter(createMemoryHistory())
  await router.push(path)
  await router.isReady()
  return router.currentRoute.value
}

beforeEach(() => {
  phone = false
  sendDraft.value = null
  wallet.hasWallets = ref(false) as never
  wallet.unlockedWallets.value = ['z1known']
  wallet.activeWallet.value = { baseAddress: 'z1known' }
  wallet.ensureLoaded.mockClear()
  wallet.setActiveWallet.mockReset()
  wallet.setActiveWallet.mockResolvedValue(undefined)
  show.mockClear()
  clearSetupDraft()
})

describe('web routes guard', () => {
  it.each(['/', '/send'])('sends %s to setup when there is no wallet', async (path) => {
    const route = await navigate(path)

    expect(route.name).toBe('welcome')
    expect(route.fullPath).toBe('/welcome')
  })

  it('loads wallet data before deciding', async () => {
    await navigate('/')

    expect(wallet.ensureLoaded).toHaveBeenCalled()
  })

  it('redirects /setup to /welcome when a wallet exists', async () => {
    wallet.hasWallets.value = true

    const route = await navigate('/setup')

    expect(route.name).toBe('welcome')
    expect(route.fullPath).toBe('/welcome')
  })

  it('resolves /send with no unlock redirect', async () => {
    wallet.hasWallets.value = true

    const route = await navigate('/send')

    expect(route.name).toBe('send')
    expect(route.fullPath).toBe('/send')
  })

  it.each([
    ['/rewards', 'rewards'],
    ['/pillars', 'pillars'],
    ['/staking', 'staking'],
    ['/tokens', 'tokens'],
  ])('resolves %s to the %s page when a wallet exists', async (path, name) => {
    wallet.hasWallets.value = true

    const route = await navigate(path)

    expect(route.name).toBe(name)
    expect(route.meta.requiresWallet).toBe(true)
  })

  it.each(['/rewards', '/pillars', '/staking', '/tokens'])(
    'sends %s to setup without a wallet',
    async (path) => {
      const route = await navigate(path)

      expect(route.name).toBe('welcome')
    }
  )

  it.each(['/', '/interrupted'])('renders the Dashboard page at %s', async (path) => {
    wallet.hasWallets.value = true
    const router = createWebRouter(createMemoryHistory())

    await router.push(path)
    await router.isReady()

    expect(router.currentRoute.value.matched[0].components?.large).toMatchObject({
      name: 'Dashboard',
    })
  })

  it('resolves /activity with a wallet to the Activity page behind the wallet gate', async () => {
    wallet.hasWallets.value = true
    const router = createWebRouter(createMemoryHistory())

    await router.push('/activity')
    await router.isReady()
    const route = router.currentRoute.value

    expect(route.name).toBe('activity')
    expect(route.meta.requiresWallet).toBe(true)
    expect(route.meta.layout).not.toBe('bare')
    expect(route.matched[0].components?.large).toMatchObject({ name: 'Activity' })
  })

  it('resolves /apps with a wallet to the Connected apps page behind the wallet gate', async () => {
    wallet.hasWallets.value = true
    const router = createWebRouter(createMemoryHistory())

    await router.push('/apps')
    await router.isReady()
    const route = router.currentRoute.value

    expect(route.name).toBe('apps')
    expect(route.meta.requiresWallet).toBe(true)
    expect(route.matched[0].components?.large).toMatchObject({ name: 'ConnectedApps' })
  })

  it('redirects /walletconnect to /apps', async () => {
    wallet.hasWallets.value = true

    const route = await navigate('/walletconnect')

    expect(route.name).toBe('apps')
    expect(route.fullPath).toBe('/apps')
  })

  it('sends /apps to welcome without a wallet', async () => {
    expect((await navigate('/apps')).name).toBe('welcome')
  })

  it('sends /activity to welcome without a wallet', async () => {
    expect((await navigate('/activity')).name).toBe('welcome')
  })

  it('resolves /token/:tokenStandard to the TokenDetails page', async () => {
    wallet.hasWallets.value = true
    const router = createWebRouter(createMemoryHistory())

    await router.push('/token/zts1znnxxxxxxxxxxxxx9z4ulx')
    await router.isReady()
    const route = router.currentRoute.value

    expect(route.name).toBe('token')
    expect(route.params.tokenStandard).toBe('zts1znnxxxxxxxxxxxxx9z4ulx')
    expect(route.meta.requiresWallet).toBe(true)
    expect(route.matched[0].components?.large).toMatchObject({ name: 'TokenDetails' })
  })

  it('resolves an unknown path to home', async () => {
    wallet.hasWallets.value = true

    const route = await navigate('/nowhere/at/all')

    expect(route.name).toBe('home')
    expect(route.fullPath).toBe('/')
  })

  it('redirects /setup to /welcome without a wallet', async () => {
    const route = await navigate('/setup')

    expect(route.name).toBe('welcome')
    expect(route.fullPath).toBe('/welcome')
  })

  it.each([
    ['/welcome', 'welcome'],
    ['/import', 'import-phrase'],
    ['/create/password', 'create-password'],
  ])('keeps %s reachable with a wallet', async (path, name) => {
    wallet.hasWallets.value = true

    expect((await navigate(path)).name).toBe(name)
  })

  it('sends /settings to the wallets tab', async () => {
    wallet.hasWallets.value = true

    const route = await navigate('/settings')

    expect(route.name).toBe('settings-wallets')
    expect(route.fullPath).toBe('/settings/wallets')
  })

  it.each([
    ['/settings/wallets', 'settings-wallets'],
    ['/settings/security', 'settings-security'],
    ['/settings/network', 'settings-network'],
  ])('resolves %s with a wallet', async (path, name) => {
    wallet.hasWallets.value = true

    expect((await navigate(path)).name).toBe(name)
  })

  it.each(['/settings/network', '/settings', '/settings/wallets'])(
    'sends %s to welcome without a wallet',
    async (path) => {
      expect((await navigate(path)).name).toBe('welcome')
    }
  )

  it('gives the first-run routes the bare layout', async () => {
    for (const path of ['/welcome', '/import', '/create/password']) {
      expect((await navigate(path)).meta.layout).toBe('bare')
    }
  })

  it('sends /create/phrase with no draft to create-password', async () => {
    expect((await navigate('/create/phrase')).name).toBe('create-password')
  })

  it('sends /create/verify with no draft to create-password', async () => {
    expect((await navigate('/create/verify')).name).toBe('create-password')
  })

  it('sends /create/verify before the phrase exists to create-phrase', async () => {
    setCreatePassword('Main', 'pw')

    expect((await navigate('/create/verify')).name).toBe('create-phrase')
  })

  it('opens the create steps once the draft has a phrase', async () => {
    setCreatePassword('Main', 'pw')
    ensureCreateMnemonic()
    const router = createWebRouter(createMemoryHistory())

    await router.push('/create/phrase')
    expect(router.currentRoute.value.name).toBe('create-phrase')
    await router.push('/create/verify')
    expect(router.currentRoute.value.name).toBe('create-verify')
  })

  it('sends /import/password with no import draft to import-phrase', async () => {
    expect((await navigate('/import/password')).name).toBe('import-phrase')
  })

  it('sends /import/password with a create draft to import-phrase', async () => {
    setCreatePassword('Main', 'pw')

    expect((await navigate('/import/password')).name).toBe('import-phrase')
  })

  it('opens /import/password with an import draft', async () => {
    startImportDraft('abandon '.repeat(23) + 'art')

    expect((await navigate('/import/password')).name).toBe('import-password')
  })

  it('clears the draft when navigating from a create route to home', async () => {
    wallet.hasWallets.value = true
    setCreatePassword('Main', 'pw')
    ensureCreateMnemonic()
    const router = createWebRouter(createMemoryHistory())
    await router.push('/create/phrase')
    expect(getSetupDraft()).not.toBeNull()

    await router.push('/')

    expect(getSetupDraft()).toBeNull()
  })
})

describe('/tokens/issue route', () => {
  it('resolves to the Issue token page behind the wallet gate', async () => {
    wallet.hasWallets.value = true
    const router = createWebRouter(createMemoryHistory())

    await router.push('/tokens/issue')
    await router.isReady()
    const route = router.currentRoute.value

    expect(route.name).toBe('token-issue')
    expect(route.meta.requiresWallet).toBe(true)
    expect(route.matched[0].components?.large).toBeDefined()
  })

  it('goes to welcome without a wallet', async () => {
    const route = await navigate('/tokens/issue')

    expect(route.name).toBe('welcome')
  })
})

describe('two-layout records', () => {
  it.each([
    ['/', ['large', 'small']],
    ['/send', ['large', 'small']],
    ['/receive', ['large', 'small']],
    ['/token/zts1x', ['large', 'small']],
    ['/tx/abc', ['large', 'small']],
    ['/interrupted', ['large', 'small']],
    ['/plasma', ['large', 'small']],
    ['/rewards', ['large', 'small']],
    ['/apps', ['large', 'small']],
    ['/settings/wallets', ['large', 'small']],
    ['/settings/security', ['large', 'small']],
    ['/settings/network', ['large', 'small']],
    ['/welcome', ['large', 'small']],
    ['/send/review', ['small']],
    ['/settings', ['small']],
    ['/settings/wallets/z1known', ['small']],
    ['/settings/wallets/z1known/export', ['small']],
    ['/activity', ['large']],
    ['/pillars', ['large']],
    ['/staking', ['large']],
    ['/tokens', ['large']],
    ['/tokens/issue', ['large']],
  ])('gives %s its views', (path, views) => {
    const router = createWebRouter(createMemoryHistory())

    expect(Object.keys(router.resolve(path).matched[0].components ?? {}).sort()).toEqual(views)
  })

  it('keeps every small route name with its small view', () => {
    const router = createWebRouter(createMemoryHistory())
    const small = new Set(smallRoutes.map((r) => r.name))
    const named = router.getRoutes().filter((r) => small.has(r.name))

    expect(named.length).toBe(smallRoutes.length)
    for (const record of named) expect(record.components?.small).toBeDefined()
    expect(router.getRoutes().filter((r) => r.name !== undefined).length).toBe(
      smallRoutes.length + 5
    )
  })

  it("uses the web's own Connected apps page on phones", async () => {
    wallet.hasWallets.value = true
    phone = true
    const router = createWebRouter(createMemoryHistory())

    await router.push('/apps')

    expect(router.currentRoute.value.matched[0].components?.small).toMatchObject({
      name: 'SmallConnectedApps',
    })
  })
})

describe('layout fallback guard', () => {
  beforeEach(() => {
    wallet.hasWallets.value = true
  })

  it('sends /activity on a phone to the Activity tab of home', async () => {
    phone = true

    const route = await navigate('/activity')

    expect(route.name).toBe('home')
    expect(route.query.tab).toBe('activity')
  })

  it('sends /pillars on a phone to home with the wide-screen notice', async () => {
    phone = true

    const route = await navigate('/pillars')

    expect(route.name).toBe('home')
    expect(show).toHaveBeenCalledWith('Pillars, staking and tokens need a wider screen.', 'info')
  })

  it('keeps /settings on a phone', async () => {
    phone = true

    expect((await navigate('/settings')).name).toBe('settings')
  })

  it('keeps /send/review on a phone when a draft exists', async () => {
    phone = true
    sendDraft.value = {
      tokenStandard: 'zts1x',
      symbol: 'X',
      decimals: 8,
      amount: '1',
      recipient: 'z1a',
      from: 'z1b',
    }

    expect((await navigate('/send/review')).name).toBe('send-review')
  })

  it('sends /send/review on a large screen to send and keeps the draft', async () => {
    const draft = {
      tokenStandard: 'zts1x',
      symbol: 'X',
      decimals: 8,
      amount: '1',
      recipient: 'z1a',
      from: 'z1b',
    }
    sendDraft.value = draft

    const route = await navigate('/send/review')

    expect(route.name).toBe('send')
    expect(sendDraft.value).toEqual(draft)
  })

  it('sends a manage page on a large screen to the wallets tab', async () => {
    const route = await navigate('/settings/wallets/z1known/export')

    expect(route.name).toBe('settings-wallets')
  })
})

describe('manage page of another wallet', () => {
  beforeEach(() => {
    wallet.hasWallets.value = true
    phone = true
  })

  it('makes a locked, non-active wallet active before its page shows', async () => {
    const route = await navigate('/settings/wallets/z1other')

    expect(wallet.setActiveWallet).toHaveBeenCalledWith('z1other')
    expect(route.name).toBe('manage-wallet')
  })

  it('does not switch for an unlocked wallet', async () => {
    wallet.unlockedWallets.value = ['z1known', 'z1other']

    await navigate('/settings/wallets/z1other')

    expect(wallet.setActiveWallet).not.toHaveBeenCalled()
  })

  it('does not switch for the active wallet', async () => {
    wallet.unlockedWallets.value = []

    await navigate('/settings/wallets/z1known')

    expect(wallet.setActiveWallet).not.toHaveBeenCalled()
  })

  it('goes to the wallets tab when the switch fails', async () => {
    wallet.setActiveWallet.mockRejectedValue(new Error('nope'))

    expect((await navigate('/settings/wallets/z1other')).name).toBe('settings-wallets')
  })
})

describe('guard for every one-layout route', () => {
  beforeEach(() => {
    wallet.hasWallets.value = true
  })

  it.each(['/pillars', '/staking', '/tokens', '/tokens/issue'])(
    'sends %s on a phone to home with the notice',
    async (path) => {
      phone = true

      const route = await navigate(path)

      expect(route.name).toBe('home')
      expect(route.query.tab).toBeUndefined()
      expect(show).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['/settings', '/settings/wallets/z1known', '/settings/wallets/z1known/export'])(
    'sends %s on a large screen to the wallets tab with no notice',
    async (path) => {
      const route = await navigate(path)

      expect(route.name).toBe('settings-wallets')
      expect(show).not.toHaveBeenCalled()
    }
  )

  it.each(['/', '/send', '/receive', '/plasma', '/rewards', '/apps', '/settings/network'])(
    'keeps %s on both layouts with no notice',
    async (path) => {
      const large = await navigate(path)
      phone = true
      const small = await navigate(path)

      expect(small.name).toBe(large.name)
      expect(show).not.toHaveBeenCalled()
    }
  )

  it('keeps /activity on a large screen', async () => {
    expect((await navigate('/activity')).name).toBe('activity')
  })
})

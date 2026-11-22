import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

// What chrome.storage holds; the main popup changes it, not this window.
const stored = { activeAccountAddress: 'z1account-a', chainId: 1 }

const walletState = {
  activeAccountAddress: ref<string | null>('z1account-a'),
  loadWalletData: vi.fn(async () => {
    walletState.activeAccountAddress.value = stored.activeAccountAddress
  }),
}
const networkState = {
  chainId: ref(1),
  syncNetworkConfig: vi.fn(async () => {
    networkState.chainId.value = stored.chainId
  }),
}
const service = {
  initialize: vi.fn(async () => {}),
  setActiveAccount: vi.fn(async () => {}),
  emitChainIdChange: vi.fn(async () => {}),
}

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  WALLETCONNECT_ENABLED: true,
}))
vi.mock('@/core/walletconnect-service', () => ({
  WalletConnectService: { getInstance: () => service },
  walletConnectSessions: ref([]),
}))
vi.mock('@/core/composables/useWallet', () => ({ useWallet: () => walletState }))
vi.mock('@/core/composables/useNetwork', () => ({ useNetwork: () => networkState }))

type StorageListener = (changes: Record<string, unknown>, areaName: string) => void
let storageListener: StorageListener = () => {}

vi.stubGlobal('__IS_EXTENSION__', true)
vi.stubGlobal('chrome', {
  storage: {
    onChanged: { addListener: (listener: StorageListener) => (storageListener = listener) },
  },
})

// One module instance for the whole file: its watchers register once.
const { useWalletConnect } = await import('@/core/composables/useWalletConnect')
await useWalletConnect().initialize()

beforeEach(async () => {
  stored.activeAccountAddress = 'z1account-a'
  stored.chainId = 1
  walletState.activeAccountAddress.value = 'z1account-a'
  networkState.chainId.value = 1
  // Let the reset's own watcher runs finish before counting calls.
  await nextTick()
  vi.clearAllMocks()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function storageChanged(key: string, areaName = 'local'): Promise<void> {
  storageListener({ [key]: { newValue: {} } }, areaName)
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await nextTick()
}

describe('useWalletConnect in the extension window', () => {
  it('sends addressChange when another window switches the active account', async () => {
    stored.activeAccountAddress = 'z1account-b'

    await storageChanged('nom-wallet-storage')

    expect(service.setActiveAccount).toHaveBeenCalledWith('z1account-b')
  })

  it('sends chainIdChange when another window switches the chain', async () => {
    stored.chainId = 3

    await storageChanged('nom-wallet-chain-id')

    expect(networkState.syncNetworkConfig).toHaveBeenCalledOnce()
    expect(service.emitChainIdChange).toHaveBeenCalledWith(3)
  })

  it('sends nothing when the stored values match this window', async () => {
    await storageChanged('nom-wallet-storage')
    await storageChanged('nom-wallet-chain-id')

    expect(service.setActiveAccount).not.toHaveBeenCalled()
    expect(service.emitChainIdChange).not.toHaveBeenCalled()
  })

  it('ignores session storage', async () => {
    stored.activeAccountAddress = 'z1account-b'

    await storageChanged('nom-wallet-storage', 'session')

    expect(walletState.loadWalletData).not.toHaveBeenCalled()
  })
})

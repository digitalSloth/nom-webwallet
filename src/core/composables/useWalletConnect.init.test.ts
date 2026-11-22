import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const service = vi.hoisted(() => ({
  initialize: vi.fn(),
  pair: vi.fn<(uri: string) => Promise<void>>(async () => {}),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  WALLETCONNECT_ENABLED: true,
}))
vi.mock('@/core/walletconnect-service', () => ({
  WalletConnectService: { getInstance: () => service },
  walletConnectSessions: ref([]),
}))
vi.mock('@/core/walletconnect-session-meta', () => ({ readSessionMeta: vi.fn(async () => ({})) }))
vi.mock('@/core/composables/useWallet', () => ({
  useWallet: () => ({ activeAccountAddress: ref(null) }),
}))
vi.mock('@/core/composables/useNetwork', () => ({ useNetwork: () => ({ chainId: ref(1) }) }))
vi.stubGlobal('__IS_EXTENSION__', false)

const { useWalletConnect } = await import('@/core/composables/useWalletConnect')

describe('useWalletConnect start-up', () => {
  it('stays uninitialised after a failed start and retries on the next initialize()', async () => {
    const wc = useWalletConnect()
    service.initialize.mockRejectedValueOnce(new Error('relay down'))

    await expect(wc.initialize()).rejects.toThrow('relay down')
    expect(wc.isInitialized.value).toBe(false)
    expect(wc.error.value).toBe('relay down')

    service.initialize.mockResolvedValueOnce(undefined)
    await wc.initialize()

    expect(service.initialize).toHaveBeenCalledTimes(2)
    expect(wc.isInitialized.value).toBe(true)
    expect(wc.error.value).toBeNull()
  })

  it('rejects a failed pair, records the message and clears isPairing', async () => {
    const wc = useWalletConnect()
    service.pair.mockRejectedValueOnce(new Error('expired'))

    await expect(wc.pair('wc:abc')).rejects.toThrow('expired')

    expect(wc.error.value).toBe('expired')
    expect(wc.isPairing.value).toBe(false)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SessionMeta } from '@/core/walletconnect-session-meta'

const service = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  setActiveAccount: vi.fn(async () => {}),
  emitChainIdChange: vi.fn(async () => {}),
  disconnect: vi.fn<(topic: string) => Promise<void>>(async () => {}),
}))
const readSessionMeta = vi.hoisted(() => vi.fn())
const sessions = vi.hoisted(() => ({ value: null as never }))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  WALLETCONNECT_ENABLED: true,
}))
vi.mock('@/core/walletconnect-service', async () => {
  const { ref } = await import('vue')
  sessions.value = ref([]) as never
  return {
    WalletConnectService: { getInstance: () => service },
    walletConnectSessions: sessions.value,
  }
})
vi.mock('@/core/walletconnect-session-meta', () => ({ readSessionMeta }))
vi.mock('@/core/composables/useWallet', () => ({
  useWallet: () => ({ activeAccountAddress: ref(null) }),
}))
vi.mock('@/core/composables/useNetwork', () => ({ useNetwork: () => ({ chainId: ref(1) }) }))

vi.stubGlobal('__IS_EXTENSION__', false)

// One module instance: the watchers register once, on the first initialize().
const meta = (topic: string): Record<string, SessionMeta> => ({
  [topic]: { verification: 'valid', approvedAt: 1 },
})
readSessionMeta.mockResolvedValue(meta('t1'))
const { useWalletConnect } = await import('@/core/composables/useWalletConnect')
const wc = useWalletConnect()
await wc.initialize()

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await nextTick()
}

function setSessions(topics: string[]): void {
  ;(sessions.value as { value: unknown }).value = topics.map((topic) => ({ topic }))
}

beforeEach(async () => {
  await flush()
  vi.clearAllMocks()
  service.disconnect.mockResolvedValue(undefined)
})

describe('useWalletConnect session meta on the web', () => {
  it('holds the stored meta after initialize()', () => {
    expect(wc.sessionMeta.value).toEqual(meta('t1'))
  })

  it('reloads when the sessions change', async () => {
    readSessionMeta.mockResolvedValueOnce(meta('t2'))

    setSessions(['t2'])
    await flush()

    expect(readSessionMeta).toHaveBeenCalledOnce()
    expect(wc.sessionMeta.value).toEqual(meta('t2'))
  })

  it('does not let an older read that resolves late overwrite a newer one', async () => {
    let resolveOld: (value: Record<string, SessionMeta>) => void = () => {}
    readSessionMeta.mockImplementationOnce(
      () => new Promise<Record<string, SessionMeta>>((r) => (resolveOld = r))
    )
    readSessionMeta.mockResolvedValueOnce(meta('new'))

    setSessions(['a'])
    await flush()
    setSessions(['a', 'b'])
    await flush()
    resolveOld(meta('old'))
    await flush()

    expect(wc.sessionMeta.value).toEqual(meta('new'))
  })

  it('keeps the previous value when a read fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    readSessionMeta.mockResolvedValueOnce(meta('kept'))
    setSessions(['k'])
    await flush()
    readSessionMeta.mockRejectedValueOnce(new Error('storage'))

    setSessions(['k', 'l'])
    await flush()

    expect(wc.sessionMeta.value).toEqual(meta('kept'))
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('useWalletConnect disconnectAll', () => {
  it('disconnects every topic in order and resolves', async () => {
    setSessions(['x', 'y', 'z'])

    await expect(wc.disconnectAll()).resolves.toBeUndefined()

    expect(service.disconnect.mock.calls.map((c) => c[0])).toEqual(['x', 'y', 'z'])
  })

  it('continues past a rejection and then rejects with the first error', async () => {
    const first = new Error('first')
    service.disconnect
      .mockRejectedValueOnce(first)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('third'))
    setSessions(['x', 'y', 'z'])

    await expect(wc.disconnectAll()).rejects.toBe(first)

    expect(service.disconnect).toHaveBeenCalledTimes(3)
  })
})

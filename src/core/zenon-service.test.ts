import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = {
  initialize: vi.fn(async () => {}),
  clearConnection: vi.fn(),
}

vi.mock('znn-typescript-sdk', () => ({
  isPowWorkerSupported: () => false,
  Zenon: {
    getInstance: () => sdk,
    setChainID: vi.fn(),
    setNetworkID: vi.fn(),
    setPowBasePath: vi.fn(),
  },
}))
vi.mock('@/core/storage/storage-service', () => ({ storageService: { get: async () => null } }))
vi.mock('@/core/pow-status', () => ({ trackPow: (generate: unknown) => generate }))
vi.mock('@/core/extension-pow-provider', () => ({ sandboxPowProvider: {} }))

type ZenonServiceClass = (typeof import('@/core/zenon-service'))['ZenonService']
let ZenonService: ZenonServiceClass

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  ZenonService = (await import('@/core/zenon-service')).ZenonService
})

describe('ZenonService.initialize', () => {
  it('retries after a failed connect instead of caching the failure', async () => {
    sdk.initialize.mockRejectedValueOnce(new Error('connect timeout'))
    const service = ZenonService.getInstance()

    await expect(service.ensureInitialized()).rejects.toThrow('connect timeout')
    expect(sdk.clearConnection).toHaveBeenCalledOnce()
    expect(service.isConnected()).toBe(false)

    await expect(service.ensureInitialized()).resolves.toBeUndefined()
    expect(sdk.initialize).toHaveBeenCalledTimes(2)
    expect(service.isConnected()).toBe(true)
  })

  it('shares one attempt between concurrent callers', async () => {
    const service = ZenonService.getInstance()

    await Promise.all([service.ensureInitialized(), service.ensureInitialized()])

    expect(sdk.initialize).toHaveBeenCalledOnce()
  })

  it('does not tear down a newer connection when a replaced attempt fails', async () => {
    let failFirst: (err: Error) => void = () => {}
    sdk.initialize.mockImplementationOnce(
      () => new Promise<void>((_resolve, reject) => (failFirst = reject))
    )
    const service = ZenonService.getInstance()
    const first = service.initialize()
    await Promise.resolve()

    service.disconnect()
    const second = service.initialize()
    await second
    sdk.clearConnection.mockClear()
    failFirst(new Error('connect timeout'))

    await expect(first).rejects.toThrow('connect timeout')
    expect(sdk.clearConnection).not.toHaveBeenCalled()
    expect(service.isConnected()).toBe(true)
  })
})

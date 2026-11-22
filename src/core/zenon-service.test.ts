import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Stands in for the SDK's WsClient: records close listeners. */
class FakeWsClient {
  closeListeners: Array<(code: number, reason: string) => void> = []
  onClose(listener: (code: number, reason: string) => void): () => void {
    this.closeListeners.push(listener)
    return () => {}
  }
  emitClose(code = 1006): void {
    for (const listener of this.closeListeners) listener(code, '')
  }
}

const sdk: {
  client: unknown
  initialize: ReturnType<typeof vi.fn>
  clearConnection: ReturnType<typeof vi.fn>
} = {
  client: undefined,
  initialize: vi.fn(async () => {}),
  clearConnection: vi.fn(),
}
const reportNodeFailure = vi.fn()
const storageGet = vi.fn<(key: string) => Promise<unknown>>(async () => null)

vi.mock('znn-typescript-sdk', () => ({
  isPowWorkerSupported: () => false,
  WsClient: FakeWsClient,
  Zenon: {
    getInstance: () => sdk,
    setChainID: vi.fn(),
    setNetworkID: vi.fn(),
    setPowBasePath: vi.fn(),
  },
}))
vi.mock('@/core/storage/storage-service', () => ({
  storageService: { get: (key: string) => storageGet(key) },
}))
vi.mock('@/core/node-health', () => ({ reportNodeFailure: () => reportNodeFailure() }))
vi.mock('@/core/pow-status', () => ({ trackPow: (generate: unknown) => generate }))
vi.stubGlobal('__IS_EXTENSION__', false)

type ZenonServiceClass = (typeof import('@/core/zenon-service'))['ZenonService']
let ZenonService: ZenonServiceClass

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  sdk.client = undefined
  sdk.initialize.mockImplementation(async () => {})
  sdk.clearConnection.mockImplementation(() => {
    sdk.client = undefined
  })
  storageGet.mockImplementation(async () => null)
  ZenonService = (await import('@/core/zenon-service')).ZenonService
})

describe('ZenonService.initialize', () => {
  it('retries after a failed connect instead of caching the failure', async () => {
    sdk.initialize.mockRejectedValueOnce(new Error('connect timeout'))
    const service = ZenonService.getInstance()

    await expect(service.ensureInitialized()).rejects.toThrow('connect timeout')
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

describe('ZenonService.changeNode', () => {
  it('stops a connect the SDK has started instead of waiting for it', async () => {
    // Models the SDK: clearConnection() rejects the connect it interrupts.
    sdk.initialize.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          sdk.clearConnection.mockImplementationOnce(() => {
            sdk.client = undefined
            reject(new Error('Connection stopped'))
          })
        })
    )
    const service = ZenonService.getInstance()
    const first = service.initialize()
    await vi.waitFor(() => expect(sdk.initialize).toHaveBeenCalledOnce())

    await service.changeNode('wss://new.node')

    await expect(first).rejects.toThrow('Connection stopped')
    expect(sdk.initialize).toHaveBeenLastCalledWith('wss://new.node', expect.any(Number))
    expect(service.isConnected()).toBe(true)
  })

  it('waits out a connect still loading the saved node, then switches', async () => {
    let releaseSavedNode: (url: string) => void = () => {}
    storageGet.mockImplementation(async (key: string) =>
      key === 'nom-wallet-selected-node'
        ? new Promise<string>((resolve) => (releaseSavedNode = resolve))
        : null
    )
    const service = ZenonService.getInstance()
    const first = service.initialize()
    await vi.waitFor(() => expect(storageGet).toHaveBeenCalled())

    const switching = service.changeNode('wss://new.node')
    releaseSavedNode('ws://saved.node')
    await switching
    await first

    expect(service.getNodeUrl()).toBe('wss://new.node')
    expect(sdk.initialize).toHaveBeenLastCalledWith('wss://new.node', expect.any(Number))
    expect(service.isConnected()).toBe(true)
  })
})

describe('ZenonService socket watch', () => {
  let client: FakeWsClient

  beforeEach(() => {
    sdk.initialize.mockImplementation(async () => {
      client = new FakeWsClient()
      sdk.client = client
    })
  })

  it('reports a failure when the open connection drops', async () => {
    await ZenonService.getInstance().initialize()

    client.emitClose(1006)

    expect(reportNodeFailure).toHaveBeenCalledOnce()
  })

  it('reports a failure when the node closes the connection normally', async () => {
    await ZenonService.getInstance().initialize()

    client.emitClose(1000)

    expect(reportNodeFailure).toHaveBeenCalledOnce()
  })

  it('reports nothing from a replaced client', async () => {
    const service = ZenonService.getInstance()
    await service.initialize()
    const stale = client
    service.disconnect()
    await service.initialize()

    stale.emitClose(1006)

    expect(reportNodeFailure).not.toHaveBeenCalled()
  })

  it('attaches nothing when the client is not a websocket client', async () => {
    sdk.initialize.mockImplementation(async () => {
      sdk.client = {}
    })

    await expect(ZenonService.getInstance().initialize()).resolves.toBeUndefined()
  })

  it('attaches nothing when there is no client', async () => {
    sdk.initialize.mockImplementation(async () => {})

    await expect(ZenonService.getInstance().initialize()).resolves.toBeUndefined()
  })
})

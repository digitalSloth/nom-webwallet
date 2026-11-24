import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_NODE_URL,
  NODE_RETRY_MS,
  STORAGE_KEY_CHAIN_ID,
  STORAGE_KEY_NETWORK_ID,
  STORAGE_KEY_SELECTED_NODE,
} from '@/config'

const OTHER_NODE = 'wss://other.example:35998'

const state = {
  nodeUrl: DEFAULT_NODE_URL,
  walletChain: 1,
  // Chain id the frontier momentum reports, per node url.
  chains: {} as Record<string, number | Error>,
}

const store = vi.fn<(key: string, value: unknown) => Promise<void>>(async () => {})
let gate: Promise<void> | null = null

const zenonService = {
  getNodeUrl: () => state.nodeUrl,
  getChainId: () => state.walletChain,
  getNetworkId: () => 1,
  ensureConfigLoaded: async () => {},
  changeNode: vi.fn(async (url: string) => {
    if (gate) await gate
    state.nodeUrl = url
  }),
  getZenon: () => ({
    ledger: {
      getFrontierMomentum: async () => {
        const chain = state.chains[state.nodeUrl] ?? 1
        if (chain instanceof Error) throw chain
        return { height: 42, chainIdentifier: chain }
      },
    },
  }),
}

const updateNetworkConfig = vi.fn()

vi.mock('../zenon-service', () => ({
  ZenonService: { getInstance: () => zenonService, updateNetworkConfig },
  readPersistedChainId: async () => 1,
  readPersistedNetworkId: async () => 1,
}))
vi.mock('../transaction-service', () => ({
  TransactionService: { getInstance: () => ({ ensureInitialized: async () => {} }) },
}))
vi.mock('../storage/storage-service', () => ({
  storageService: { set: (k: string, v: unknown) => store(k, v) },
}))

type Mod = typeof import('./useNetwork')
type Health = typeof import('../node-health')
let mod: Mod
let health: Health

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  vi.clearAllMocks()
  store.mockImplementation(async () => {})
  state.nodeUrl = DEFAULT_NODE_URL
  state.walletChain = 1
  state.chains = {}
  gate = null
  mod = await import('./useNetwork')
  health = await import('../node-health')
})

const entry = (url: string, chainId: number, networkId = chainId) => ({ url, chainId, networkId })

describe('useNetwork selectNode', () => {
  it('reverts and stores nothing when the node is on another chain', async () => {
    state.chains[OTHER_NODE] = 3
    const net = mod.useNetwork()

    const err = await net.selectNode(entry(OTHER_NODE, 1)).catch((e) => e)

    expect(err).toBeInstanceOf(mod.NodeChainMismatchError)
    expect(err.nodeChainId).toBe(3)
    expect(err.expectedChainId).toBe(1)
    expect(zenonService.changeNode).toHaveBeenLastCalledWith(DEFAULT_NODE_URL)
    expect(state.nodeUrl).toBe(DEFAULT_NODE_URL)
    expect(net.currentNode.value).toBe(DEFAULT_NODE_URL)
    expect(store).not.toHaveBeenCalled()
    expect(updateNetworkConfig).not.toHaveBeenCalled()
    expect(net.nodeDown.value).toBe(false)
    expect(net.isConnected.value).toBe(true)
    expect(net.error.value).toBe(err.message)
  })

  it('reverts the same way when the node is unreachable, with a plain error', async () => {
    state.chains[OTHER_NODE] = new Error('connect timeout')
    const net = mod.useNetwork()

    const err = await net.selectNode(entry(OTHER_NODE, 1)).catch((e) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(mod.NodeChainMismatchError)
    expect(err.message).toBe('connect timeout')
    expect(state.nodeUrl).toBe(DEFAULT_NODE_URL)
    expect(store).not.toHaveBeenCalled()
    expect(net.nodeDown.value).toBe(false)
    expect(net.isConnected.value).toBe(true)
  })

  it('still rejects with the mismatch when another check resolves chain 1 meanwhile', async () => {
    state.chains[OTHER_NODE] = 3
    const net = mod.useNetwork()
    let open: () => void = () => {}
    gate = new Promise<void>((resolve) => (open = resolve))

    const change = net.selectNode(entry(OTHER_NODE, 1)).catch((e) => e)
    // A check on the previous node (chain 1) completes while selectNode waits.
    await expect(net.checkConnection()).resolves.toBe(1)
    open()

    expect(await change).toBeInstanceOf(mod.NodeChainMismatchError)
    expect(store).not.toHaveBeenCalled()
  })

  it('stores the node and its IDs, applies them and updates the refs', async () => {
    state.chains[OTHER_NODE] = 3
    const net = mod.useNetwork()

    await net.selectNode(entry(OTHER_NODE, 3))

    expect(store).toHaveBeenCalledWith(STORAGE_KEY_SELECTED_NODE, OTHER_NODE)
    expect(store).toHaveBeenCalledWith(STORAGE_KEY_CHAIN_ID, 3)
    expect(store).toHaveBeenCalledWith(STORAGE_KEY_NETWORK_ID, 3)
    expect(updateNetworkConfig).toHaveBeenCalledWith(3, 3)
    expect(net.currentNode.value).toBe(OTHER_NODE)
    expect(net.chainId.value).toBe(3)
    expect(net.networkId.value).toBe(3)
    expect(net.error.value).toBeNull()
  })

  it('writes the previous values back and reconnects when persisting fails', async () => {
    state.chains[OTHER_NODE] = 3
    const net = mod.useNetwork()
    store.mockImplementation(async (key, value) => {
      if (key === STORAGE_KEY_CHAIN_ID && value === 3) throw new Error('disk')
    })

    const err = await net.selectNode(entry(OTHER_NODE, 3)).catch((e) => e)

    expect(err.message).toBe('disk')
    expect(store).toHaveBeenCalledWith(STORAGE_KEY_SELECTED_NODE, DEFAULT_NODE_URL)
    expect(store).toHaveBeenCalledWith(STORAGE_KEY_CHAIN_ID, 1)
    expect(store).toHaveBeenCalledWith(STORAGE_KEY_NETWORK_ID, 1)
    expect(updateNetworkConfig).not.toHaveBeenCalled()
    expect(zenonService.changeNode).toHaveBeenLastCalledWith(DEFAULT_NODE_URL)
    expect(net.currentNode.value).toBe(DEFAULT_NODE_URL)
    expect(net.chainId.value).toBe(1)
    expect(net.isConnected.value).toBe(true)
    expect(net.error.value).toBe('disk')
  })

  it('keeps isConnected true when the current node fails the new chain check', async () => {
    const net = mod.useNetwork()
    await net.checkConnection()

    const err = await net.selectNode(entry(DEFAULT_NODE_URL, 3)).catch((e) => e)

    expect(err).toBeInstanceOf(mod.NodeChainMismatchError)
    expect(zenonService.changeNode).toHaveBeenCalledTimes(1)
    expect(net.isConnected.value).toBe(true)
    expect(net.chainId.value).toBe(1)
    expect(store).not.toHaveBeenCalled()
  })
})

describe('useNetwork checkConnection', () => {
  it('returns the chain id and clears nodeDown on success', async () => {
    health.reportNodeFailure()
    state.chains[DEFAULT_NODE_URL] = 3
    const net = mod.useNetwork()

    await expect(net.checkConnection()).resolves.toBe(3)

    expect(net.nodeDown.value).toBe(false)
    expect(net.isConnected.value).toBe(true)
  })

  it('returns null and sets nodeDown on failure', async () => {
    state.chains[DEFAULT_NODE_URL] = new Error('down')
    const net = mod.useNetwork()

    await expect(net.checkConnection()).resolves.toBeNull()

    expect(net.nodeDown.value).toBe(true)
    expect(net.isConnected.value).toBe(false)
    expect(net.error.value).toBe('down')
  })
})

describe('useNetwork initialize retry', () => {
  async function outageThenRecovery(options: { nodeRetry: boolean } | null) {
    if (options) mod.configureNetwork(options)
    state.chains[DEFAULT_NODE_URL] = new Error('down')
    const net = mod.useNetwork()
    await net.initialize()
    expect(net.nodeDown.value).toBe(true)
    state.chains[DEFAULT_NODE_URL] = 1
    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)
    return net
  }

  it('retries and clears nodeDown with nodeRetry on', async () => {
    const net = await outageThenRecovery({ nodeRetry: true })

    expect(net.nodeDown.value).toBe(false)
    expect(net.isConnected.value).toBe(true)
  })

  it('does not retry with nodeRetry off', async () => {
    const net = await outageThenRecovery({ nodeRetry: false })

    expect(net.nodeDown.value).toBe(true)
  })

  it('does not retry with the defaults', async () => {
    const net = await outageThenRecovery(null)

    expect(net.nodeDown.value).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_NODES,
  STORAGE_KEY_CHAIN_ID,
  STORAGE_KEY_CUSTOM_NODES,
  STORAGE_KEY_NETWORK_ID,
  STORAGE_KEY_SELECTED_NODE,
} from '@/config'
import { installFakeChrome } from '@/test/fake-chrome'
import { installFakeWeb } from '@/test/fake-web'

// Runs the node list and network selection against the real storage service
// on both adapters. Only the node connection and the probe are faked.

const MAINNET = DEFAULT_NODES[0]
const CUSTOM = 'wss://custom.example:35998'
const OTHER = 'wss://other.example:35998'

const node = {
  url: MAINNET.url,
  // Chain ID the frontier momentum reports, per node URL. Unlisted URLs answer 1.
  chains: {} as Record<string, number>,
}

const zenonService = {
  getNodeUrl: () => node.url,
  getChainId: () => 1,
  getNetworkId: () => 1,
  ensureConfigLoaded: async () => {},
  changeNode: async (url: string) => {
    node.url = url
  },
  getZenon: () => ({
    ledger: {
      getFrontierMomentum: async () => ({
        height: 7,
        chainIdentifier: node.chains[node.url] ?? 1,
      }),
    },
  }),
}
const updateNetworkConfig = vi.fn()
const probeChainId = vi.fn<(url: string) => Promise<number>>()

// The persisted-ID readers import the storage service per call, so they read
// the adapter of the current test after each module reset.
async function persistedId(key: string): Promise<number> {
  const { storageService } = await import('../storage/storage-service')
  const value = await storageService.get<number>(key)
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1
}

vi.mock('../zenon-service', () => ({
  ZenonService: { getInstance: () => zenonService, updateNetworkConfig },
  readPersistedChainId: () => persistedId(STORAGE_KEY_CHAIN_ID),
  readPersistedNetworkId: () => persistedId(STORAGE_KEY_NETWORK_ID),
}))
vi.mock('../transaction-service', () => ({
  TransactionService: { getInstance: () => ({ ensureInitialized: async () => {} }) },
}))
vi.mock('../node-probe', () => ({ probeChainId: (url: string) => probeChainId(url) }))

interface Backend {
  name: string
  install(): void
  seed(key: string, value: unknown): void
  raw(key: string): unknown
}

function localBackend(): Backend {
  let web: ReturnType<typeof installFakeWeb>
  return {
    name: 'localStorage',
    install: () => {
      web = installFakeWeb()
    },
    seed: (key, value) => web.localStorage.setItem(key, JSON.stringify(value)),
    raw: (key) => {
      const text = web.localStorage.getItem(key)
      return text === null ? null : JSON.parse(text)
    },
  }
}

function chromeBackend(): Backend {
  let env: ReturnType<typeof installFakeChrome>
  return {
    name: 'chrome.storage',
    install: () => {
      env = installFakeChrome()
    },
    seed: (key, value) => {
      env.local.data[key] = value
    },
    raw: (key) => env.local.data[key] ?? null,
  }
}

let nodes: ReturnType<typeof import('./useNodes').useNodes>
let net: ReturnType<typeof import('./useNetwork').useNetwork>
let custom: typeof import('../custom-nodes')

describe.each([localBackend(), chromeBackend()])('node upgrade on $name', (backend) => {
  beforeEach(async () => {
    backend.install()
    node.url = MAINNET.url
    node.chains = { [CUSTOM]: 3, [OTHER]: 5 }
    vi.resetModules()
    vi.clearAllMocks()
    custom = await import('../custom-nodes')
    const { useNetwork } = await import('./useNetwork')
    const { useNodes } = await import('./useNodes')
    net = useNetwork()
    nodes = useNodes()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('list migration', () => {
    it('gives each stored URL the persisted chain and network ID and writes entries back', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [CUSTOM, OTHER])
      backend.seed(STORAGE_KEY_CHAIN_ID, 3)
      backend.seed(STORAGE_KEY_NETWORK_ID, 4)

      const list = await custom.readCustomNodes()

      const expected = [
        { url: CUSTOM, chainId: 3, networkId: 4 },
        { url: OTHER, chainId: 3, networkId: 4 },
      ]
      expect(list).toEqual(expected)
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual(expected)
      expect(await custom.readCustomNodes()).toEqual(expected)
    })

    it('migrates with chain 1 and network 1 when no IDs are persisted', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [CUSTOM])

      expect(await custom.readCustomNodes()).toEqual([{ url: CUSTOM, chainId: 1, networkId: 1 }])
    })

    it('migrates a list stored as an index-keyed object', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, { 0: CUSTOM, 1: OTHER })
      backend.seed(STORAGE_KEY_CHAIN_ID, 3)

      const list = await custom.readCustomNodes()

      expect(list.map((entry) => [entry.url, entry.chainId])).toEqual([
        [CUSTOM, 3],
        [OTHER, 3],
      ])
    })

    it('returns an empty list and writes nothing when no list and no custom node are stored', async () => {
      expect(await custom.readCustomNodes()).toEqual([])
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toBeNull()
    })

    it('returns an empty list for an empty stored list', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [])

      expect(await custom.readCustomNodes()).toEqual([])
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([])
    })

    it('drops malformed elements and keeps the valid ones', async () => {
      const good = { url: CUSTOM, chainId: 3, networkId: 3 }
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [
        good,
        null,
        7,
        { url: OTHER },
        { url: OTHER, chainId: 0, networkId: 1 },
        { url: OTHER, chainId: 1.5, networkId: 1 },
        { url: 5, chainId: 1, networkId: 1 },
      ])

      expect(await custom.readCustomNodes()).toEqual([good])
    })

    it('treats a stored scalar as an empty list', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, 'wss://not-a-list')

      expect(await custom.readCustomNodes()).toEqual([])
    })

    it('keeps the selected custom node and its chain 3 IDs across the upgrade', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [CUSTOM])
      backend.seed(STORAGE_KEY_SELECTED_NODE, CUSTOM)
      backend.seed(STORAGE_KEY_CHAIN_ID, 3)
      backend.seed(STORAGE_KEY_NETWORK_ID, 3)

      await nodes.load()

      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBe(CUSTOM)
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBe(3)
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(3)
      const row = nodes.rows.value.find((r) => r.url === CUSTOM)
      expect(row?.ids).toBe('chain 3 · net 3')
    })

    it('adds a selected custom node that was never listed', async () => {
      backend.seed(STORAGE_KEY_SELECTED_NODE, CUSTOM)
      backend.seed(STORAGE_KEY_CHAIN_ID, 3)
      backend.seed(STORAGE_KEY_NETWORK_ID, 4)

      expect(await custom.readCustomNodes()).toEqual([{ url: CUSTOM, chainId: 3, networkId: 4 }])
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([
        { url: CUSTOM, chainId: 3, networkId: 4 },
      ])
    })

    it('keeps a migrated node on its own IDs after the wallet switches to mainnet', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [CUSTOM])
      backend.seed(STORAGE_KEY_SELECTED_NODE, CUSTOM)
      backend.seed(STORAGE_KEY_CHAIN_ID, 3)
      backend.seed(STORAGE_KEY_NETWORK_ID, 4)
      await nodes.load()

      await net.selectNode(MAINNET)

      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([
        { url: CUSTOM, chainId: 3, networkId: 4 },
      ])
      expect(await custom.readCustomNodes()).toEqual([{ url: CUSTOM, chainId: 3, networkId: 4 }])
    })
  })

  describe('selectNode', () => {
    it('restores chain 1 and network 1 on switching back to a mainnet node', async () => {
      await net.selectNode({ url: CUSTOM, chainId: 3, networkId: 4 })
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBe(3)
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(4)

      await net.selectNode(MAINNET)

      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBe(MAINNET.url)
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBe(1)
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(1)
      expect(updateNetworkConfig).toHaveBeenLastCalledWith(1, 1)
      expect(net.chainId.value).toBe(1)
      expect(net.networkId.value).toBe(1)
    })

    it('stores nothing when the node serves another chain than the entry', async () => {
      const err = await net.selectNode({ url: CUSTOM, chainId: 1, networkId: 1 }).catch((e) => e)

      expect(err.nodeChainId).toBe(3)
      expect(err.expectedChainId).toBe(1)
      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBeNull()
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBeNull()
      expect(node.url).toBe(MAINNET.url)
    })
  })

  describe('add, edit and remove', () => {
    it('checks a node, pre-fills its chain ID, then adds and connects it', async () => {
      probeChainId.mockResolvedValue(3)
      nodes.addUrl.value = CUSTOM

      await nodes.checkNode()

      expect(nodes.check.value).toMatchObject({
        status: 'reachable',
        url: CUSTOM,
        chainInput: '3',
        networkInput: '3',
      })
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toBeNull()
      expect(node.url).toBe(MAINNET.url)

      if (nodes.check.value.status === 'reachable') nodes.check.value.networkInput = '9'
      await nodes.addAndConnect()

      expect(nodes.check.value).toEqual({ status: 'idle' })
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([
        { url: CUSTOM, chainId: 3, networkId: 9 },
      ])
      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBe(CUSTOM)
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBe(3)
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(9)
    })

    it('reports the 8 second sentence when the probe fails and stores nothing', async () => {
      probeChainId.mockRejectedValue(new Error('Timed out'))
      nodes.addUrl.value = CUSTOM

      await nodes.checkNode()

      expect(nodes.check.value).toEqual({
        status: 'failed',
        message: `Couldn't reach ${CUSTOM} within 8 seconds. Check the URL and port.`,
      })
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toBeNull()
    })

    it('keeps the list unchanged when the typed chain ID differs from the node chain', async () => {
      probeChainId.mockResolvedValue(3)
      nodes.addUrl.value = CUSTOM
      await nodes.checkNode()
      if (nodes.check.value.status === 'reachable') nodes.check.value.chainInput = '2'

      await nodes.addAndConnect()

      expect(nodes.check.value.status).toBe('reachable')
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toBeNull()
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBeNull()
      expect(node.url).toBe(MAINNET.url)
    })

    it('edits the IDs of a custom node and reconnects with them', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [{ url: CUSTOM, chainId: 3, networkId: 3 }])
      await nodes.load()
      nodes.startEdit({ url: CUSTOM, chainId: 3, networkId: 3 })
      if (nodes.edit.value) nodes.edit.value.networkInput = '12'

      await nodes.saveEdit()

      expect(nodes.edit.value).toBeNull()
      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([
        { url: CUSTOM, chainId: 3, networkId: 12 },
      ])
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(12)
      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBe(CUSTOM)
    })

    it('removes the current custom node by returning to mainnet on chain 1 and network 1', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [{ url: CUSTOM, chainId: 3, networkId: 4 }])
      await nodes.load()
      await net.selectNode({ url: CUSTOM, chainId: 3, networkId: 4 })

      await nodes.remove(CUSTOM)

      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([])
      expect(backend.raw(STORAGE_KEY_SELECTED_NODE)).toBe(MAINNET.url)
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBe(1)
      expect(backend.raw(STORAGE_KEY_NETWORK_ID)).toBe(1)
    })

    it('removes a node that is not current without touching the connection', async () => {
      backend.seed(STORAGE_KEY_CUSTOM_NODES, [
        { url: CUSTOM, chainId: 3, networkId: 3 },
        { url: OTHER, chainId: 5, networkId: 5 },
      ])
      await nodes.load()

      await nodes.remove(OTHER)

      expect(backend.raw(STORAGE_KEY_CUSTOM_NODES)).toEqual([
        { url: CUSTOM, chainId: 3, networkId: 3 },
      ])
      expect(backend.raw(STORAGE_KEY_CHAIN_ID)).toBeNull()
    })
  })
})

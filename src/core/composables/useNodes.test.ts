import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NODES } from '@/config'

const A = { url: 'wss://a.example:1', chainId: 3, networkId: 4 }
const MAINNET = DEFAULT_NODES[0]

const mocks = vi.hoisted(() => ({
  selectNode: vi.fn(),
  currentNode: { value: '' },
  readCustomNodes: vi.fn(),
  writeCustomNodes: vi.fn(),
  probeChainId: vi.fn(),
}))

vi.mock('./useNetwork', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useNetwork')>()),
  useNetwork: () => ({ selectNode: mocks.selectNode, currentNode: mocks.currentNode }),
}))
vi.mock('../custom-nodes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../custom-nodes')>()),
  readCustomNodes: mocks.readCustomNodes,
  writeCustomNodes: mocks.writeCustomNodes,
}))
vi.mock('../node-probe', () => ({ probeChainId: mocks.probeChainId }))

function editing() {
  if (!nodes.edit.value) throw new Error('no edit open')
  return nodes.edit.value
}

type Nodes = ReturnType<typeof import('./useNodes').useNodes>
let useNodes: typeof import('./useNodes').useNodes
let nodes: Nodes

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.currentNode.value = MAINNET.url
  mocks.selectNode.mockResolvedValue(undefined)
  mocks.readCustomNodes.mockResolvedValue([])
  mocks.writeCustomNodes.mockResolvedValue(undefined)
  ;({ useNodes } = await import('./useNodes'))
  nodes = useNodes()
})

async function checked(url = 'wss://new.example:1', chainId = 3): Promise<void> {
  mocks.probeChainId.mockResolvedValue(chainId)
  nodes.addUrl.value = url
  await nodes.checkNode()
}

describe('useNodes checkNode', () => {
  it('reads both IDs from the node into the inputs', async () => {
    await checked('wss://new.example:1', 3)

    expect(mocks.probeChainId).toHaveBeenCalledWith('wss://new.example:1')
    expect(nodes.check.value).toEqual({
      status: 'reachable',
      url: 'wss://new.example:1',
      chainInput: '3',
      networkInput: '3',
      error: null,
    })
    expect(mocks.selectNode).not.toHaveBeenCalled()
  })

  it('fails with the unreachable sentence and connects nothing', async () => {
    mocks.probeChainId.mockRejectedValue(new Error('down'))
    nodes.addUrl.value = 'wss://new.example:1'

    await nodes.checkNode()

    expect(nodes.check.value).toEqual({
      status: 'failed',
      message: "Couldn't reach wss://new.example:1 within 8 seconds. Check the URL and port.",
    })
    expect(mocks.selectNode).not.toHaveBeenCalled()
  })

  it('fails on text that is not a node URL without probing', async () => {
    nodes.addUrl.value = 'http://x'

    await nodes.checkNode()

    expect(nodes.check.value.status).toBe('failed')
    expect(mocks.probeChainId).not.toHaveBeenCalled()
  })

  it('selects a listed node instead of probing', async () => {
    mocks.readCustomNodes.mockResolvedValue([A])
    await nodes.load()
    nodes.addUrl.value = A.url

    await nodes.checkNode()

    expect(mocks.probeChainId).not.toHaveBeenCalled()
    expect(mocks.selectNode).toHaveBeenCalledWith(A)
    expect(nodes.addUrl.value).toBe('')
  })

  it('does nothing for blank text', async () => {
    nodes.addUrl.value = '  '
    await nodes.checkNode()
    expect(nodes.check.value.status).toBe('idle')
  })

  it('resets a finished check when the URL text changes', async () => {
    await checked()
    nodes.addUrl.value = 'wss://other.example:1'
    await Promise.resolve()
    expect(nodes.check.value.status).toBe('idle')
  })
})

describe('useNodes addAndConnect', () => {
  it('connects with the typed IDs, then saves the entry', async () => {
    await checked('wss://new.example:1', 3)
    if (nodes.check.value.status === 'reachable') nodes.check.value.networkInput = '9'

    await nodes.addAndConnect()

    const entry = { url: 'wss://new.example:1', chainId: 3, networkId: 9 }
    expect(mocks.selectNode).toHaveBeenCalledWith(entry)
    expect(mocks.writeCustomNodes).toHaveBeenCalledWith([entry])
    expect(mocks.selectNode.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.writeCustomNodes.mock.invocationCallOrder[0]
    )
    expect(nodes.check.value.status).toBe('idle')
    expect(nodes.addUrl.value).toBe('')
    expect(nodes.rows.value.map((r) => r.url)).toContain(entry.url)
  })

  it.each(['', '0', '-1', '1.5', 'abc'])('blocks the input %j', async (value) => {
    await checked()
    if (nodes.check.value.status === 'reachable') nodes.check.value.chainInput = value

    await nodes.addAndConnect()

    expect(mocks.selectNode).not.toHaveBeenCalled()
    expect(nodes.check.value).toMatchObject({
      status: 'reachable',
      error: 'Chain ID and Network ID must be positive whole numbers.',
    })
  })

  it('saves nothing when selectNode fails', async () => {
    await checked()
    mocks.selectNode.mockRejectedValue(new Error('boom'))

    await nodes.addAndConnect()

    expect(mocks.writeCustomNodes).not.toHaveBeenCalled()
    expect(nodes.check.value).toMatchObject({ status: 'reachable' })
    expect((nodes.check.value as { error: string }).error).toContain("Couldn't reach")
  })

  it('reports a failed save after connecting', async () => {
    await checked()
    mocks.writeCustomNodes.mockRejectedValue(new Error('disk'))

    await nodes.addAndConnect()

    expect(nodes.check.value).toMatchObject({
      error: 'Connected, but the node could not be saved to your list.',
    })
  })

  it('does nothing before a check', async () => {
    await nodes.addAndConnect()
    expect(mocks.selectNode).not.toHaveBeenCalled()
  })
})

describe('useNodes edit', () => {
  it('saves new IDs after selectNode and closes the panel', async () => {
    mocks.readCustomNodes.mockResolvedValue([A])
    await nodes.load()
    nodes.startEdit(A)
    expect(nodes.edit.value).toMatchObject({ chainInput: '3', networkInput: '4' })
    editing().chainInput = '5'
    editing().networkInput = '6'

    await nodes.saveEdit()

    const entry = { url: A.url, chainId: 5, networkId: 6 }
    expect(mocks.selectNode).toHaveBeenCalledWith(entry)
    expect(mocks.writeCustomNodes).toHaveBeenCalledWith([entry])
    expect(nodes.edit.value).toBeNull()
  })

  it('keeps the panel open with the error when selectNode fails', async () => {
    mocks.readCustomNodes.mockResolvedValue([A])
    await nodes.load()
    nodes.startEdit(A)
    mocks.selectNode.mockRejectedValue(new Error('boom'))

    await nodes.saveEdit()

    expect(mocks.writeCustomNodes).not.toHaveBeenCalled()
    expect(nodes.edit.value?.error).toContain("Couldn't reach")
  })

  it('blocks invalid IDs and cancels', async () => {
    nodes.startEdit(A)
    editing().networkInput = '0'
    await nodes.saveEdit()
    expect(mocks.selectNode).not.toHaveBeenCalled()
    expect(nodes.edit.value?.error).toBe('Chain ID and Network ID must be positive whole numbers.')
    nodes.cancelEdit()
    expect(nodes.edit.value).toBeNull()
  })
})

describe('useNodes select and remove', () => {
  it('ignores the current node', async () => {
    await nodes.select(MAINNET)
    expect(mocks.selectNode).not.toHaveBeenCalled()
  })

  it('shows the failure sentence when a switch fails', async () => {
    mocks.selectNode.mockRejectedValue(new Error('boom'))
    await nodes.select(A)
    expect(nodes.listError.value).toContain("Couldn't reach wss://a.example:1")
    expect(nodes.pending.value).toBeNull()
  })

  it('switches off the current node before removing it', async () => {
    mocks.readCustomNodes.mockResolvedValue([A])
    await nodes.load()
    mocks.currentNode.value = A.url

    await nodes.remove(A.url)

    expect(mocks.selectNode).toHaveBeenCalledWith(MAINNET)
    expect(mocks.writeCustomNodes).toHaveBeenCalledWith([])
    expect(nodes.rows.value.map((r) => r.url)).not.toContain(A.url)
  })

  it('keeps the node when the switch fails', async () => {
    mocks.readCustomNodes.mockResolvedValue([A])
    await nodes.load()
    mocks.currentNode.value = A.url
    mocks.selectNode.mockRejectedValue(new Error('boom'))

    await nodes.remove(A.url)

    expect(mocks.writeCustomNodes).not.toHaveBeenCalled()
    expect(nodes.listError.value).toBe(
      'Could not switch to node.zenonhub.io, so a.example was not removed.'
    )
  })
})

describe('useNodes saveEntry', () => {
  it('appends, then replaces the entry with the same URL', async () => {
    await nodes.saveEntry(A)
    await nodes.saveEntry({ ...A, chainId: 8 })

    expect(mocks.writeCustomNodes).toHaveBeenLastCalledWith([{ ...A, chainId: 8 }])
    expect(nodes.rows.value.filter((r) => r.url === A.url)).toHaveLength(1)
  })

  it('skips built-in nodes', async () => {
    await nodes.saveEntry(MAINNET)
    expect(mocks.writeCustomNodes).not.toHaveBeenCalled()
  })

  it('throws when the write fails and leaves the list unchanged', async () => {
    mocks.writeCustomNodes.mockRejectedValue(new Error('disk'))
    await expect(nodes.saveEntry(A)).rejects.toThrow('disk')
    expect(nodes.rows.value.map((r) => r.url)).not.toContain(A.url)
  })
})

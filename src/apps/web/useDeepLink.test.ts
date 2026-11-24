import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import type { LocationQuery } from 'vue-router'

class MismatchError extends Error {
  constructor(
    readonly nodeChainId: number,
    readonly expectedChainId: number
  ) {
    super('mismatch')
  }
}

const route = vi.hoisted(() => ({
  value: null as never as { path: string; hash: string; query: LocationQuery },
}))
const router = vi.hoisted(() => ({ replace: vi.fn() }))
const toast = vi.hoisted(() => ({ show: vi.fn() }))
const OLD = 'wss://old.example:35998'
const calls = vi.hoisted(() => ({ log: [] as string[] }))
const network = vi.hoisted(() => ({
  chainId: { value: 1 },
  networkId: { value: 1 },
  currentNode: { value: 'wss://old.example:35998' },
  loadConfig: vi.fn(),
  selectNode: vi.fn(),
}))
const nodes = vi.hoisted(() => ({
  rows: { value: [] as { url: string; chainId: number; networkId: number }[] },
  load: vi.fn(),
  saveEntry: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRoute: () => route.value, useRouter: () => router }))
vi.mock('nom-ui', () => ({ useToast: () => toast }))
vi.mock('@/core', async () => ({
  NodeChainMismatchError: MismatchError,
  useNetwork: () => network,
  useNodes: () => nodes,
}))
vi.mock('@/core/custom-nodes', async () => {
  const { DEFAULT_NODES } = await import('@/config')
  return { isBuiltInNode: (url: string) => DEFAULT_NODES.some((node) => node.url === url) }
})

const { parseDeepLink, deepLinkFailureText, linkEntry, linkPreview, useDeepLink } =
  await import('./useDeepLink')

describe('parseDeepLink', () => {
  it('returns null when no link key is present, ignoring other keys', () => {
    expect(parseDeepLink({})).toBeNull()
    expect(parseDeepLink({ foo: 'bar' })).toBeNull()
  })

  it('accepts ws and wss nodes and trims them', () => {
    expect(parseDeepLink({ node: ' wss://a.example:443 ' })).toEqual({
      node: 'wss://a.example:443',
      chainId: null,
      networkId: null,
    })
    expect(parseDeepLink({ node: 'ws://127.0.0.1:35998' })).toMatchObject({
      node: 'ws://127.0.0.1:35998',
    })
  })

  it.each([
    'wss://node.zenon.network@evil.example',
    'wss://u:p@evil.example',
    'wss://:p@evil.example',
    'wss://a.example/x y',
    'wss://a.example/x\u007f',
    'wss://n\u043Ede.example',
    'wss://a.example/\u202Ex',
  ])('rejects the node %s', (node) => {
    expect(parseDeepLink({ node })).toBe('invalid')
  })

  it.each(['https://x.example', 'javascript:alert(1)', 'wss://', '', 'wss:// '])(
    'rejects the node %j',
    (node) => {
      expect(parseDeepLink({ node })).toBe('invalid')
    }
  )

  it('rejects an array value for any key', () => {
    expect(parseDeepLink({ node: ['wss://a.example', 'wss://b.example'] })).toBe('invalid')
    expect(parseDeepLink({ chainId: ['3', '4'] })).toBe('invalid')
    expect(parseDeepLink({ networkId: ['3'] })).toBe('invalid')
  })

  it('rejects a null query value', () => {
    expect(parseDeepLink({ chainId: null })).toBe('invalid')
  })

  it('accepts positive integer ids', () => {
    expect(parseDeepLink({ chainId: '3', networkId: '12' })).toEqual({
      node: null,
      chainId: 3,
      networkId: 12,
    })
  })

  it.each(['0', '-1', '3abc', '1.5', '', '9007199254740993', '03', ' 3', '1e3'])(
    'rejects the id %j',
    (id) => {
      expect(parseDeepLink({ chainId: id })).toBe('invalid')
      expect(parseDeepLink({ networkId: id })).toBe('invalid')
    }
  )

  it('voids the whole link when one key is valid and another invalid', () => {
    expect(parseDeepLink({ node: 'wss://a.example', chainId: 'x' })).toBe('invalid')
    expect(parseDeepLink({ chainId: '3', networkId: '0' })).toBe('invalid')
  })
})

describe('linkEntry', () => {
  const current = { url: 'wss://old.example:1', chainId: 5, networkId: 6 }
  const link = (node: string | null, chainId: number | null, networkId: number | null) => ({
    node,
    chainId,
    networkId,
  })

  it('uses the link IDs over everything else', () => {
    expect(linkEntry(link('wss://a.example', 3, 4), [], current)).toEqual({
      url: 'wss://a.example',
      chainId: 3,
      networkId: 4,
    })
  })

  it('takes a missing chain ID from the known entry for that URL', () => {
    const known = [{ url: 'wss://a.example', chainId: 7, networkId: 8 }]
    expect(linkEntry(link('wss://a.example', null, null), known, current)).toEqual(known[0])
  })

  it('takes a missing chain ID from the current IDs for an unknown URL', () => {
    expect(linkEntry(link('wss://a.example', null, null), [], current)).toEqual({
      url: 'wss://a.example',
      chainId: 5,
      networkId: 6,
    })
  })

  it('keeps the base network ID while the chain is unchanged', () => {
    expect(linkEntry(link(null, 5, null), [], current)).toEqual(current)
  })

  it('uses the chain ID as the network ID when the chain changes', () => {
    expect(linkEntry(link(null, 3, null), [], current)).toEqual({
      url: current.url,
      chainId: 3,
      networkId: 3,
    })
  })

  it('applies a link with only a network ID to the current node', () => {
    expect(linkEntry(link(null, null, 9), [], current)).toEqual({ ...current, networkId: 9 })
  })
})

describe('linkPreview', () => {
  const current = { url: 'wss://old.example:1', chainId: 1, networkId: 1 }
  const listed = [{ url: 'wss://test.example', chainId: 3, networkId: 3 }]
  const link = (node: string | null, chainId: number | null, networkId: number | null) => ({
    node,
    chainId,
    networkId,
  })

  it('shows both IDs for a node-only link to a listed node on another chain', () => {
    expect(linkPreview(link('wss://test.example', null, null), listed, current)).toEqual({
      entry: listed[0],
      showChainId: true,
      showNetworkId: true,
    })
  })

  it('shows no ID for a node-only link that keeps the IDs', () => {
    expect(linkPreview(link('wss://other.example', null, null), [], current)).toMatchObject({
      showChainId: false,
      showNetworkId: false,
    })
  })

  it('shows the network ID but not the chain ID for a network-only link', () => {
    expect(linkPreview(link(null, null, 9), [], current)).toMatchObject({
      showChainId: false,
      showNetworkId: true,
    })
  })

  it('shows an ID the link names even when it equals the current one', () => {
    expect(linkPreview(link(null, 1, null), [], current)).toMatchObject({
      showChainId: true,
      showNetworkId: false,
    })
  })

  it('shows the network ID a chain-only link changes', () => {
    expect(linkPreview(link(null, 3, null), [], current)).toMatchObject({
      showChainId: true,
      showNetworkId: true,
    })
  })
})

describe('deepLinkFailureText', () => {
  const now = { node: 'wss://old.example:35998', chainId: 1 }

  it('describes a chain mismatch', () => {
    expect(deepLinkFailureText(new MismatchError(3, 1), 'node', now)).toBe(
      "That node is on chain ID 3, not chain ID 1. You're still on old.example, chain ID 1."
    )
  })

  it('describes an unreachable node', () => {
    expect(deepLinkFailureText(new Error('x'), 'node', now)).toBe(
      "Couldn't reach that node within 8 seconds. You're still on old.example, chain ID 1."
    )
  })

  it('describes a link that needs a node of its own', () => {
    expect(deepLinkFailureText(null, 'built-in', now)).toBe(
      "Built-in nodes use chain ID 1 and network ID 1, so this link needs a node of its own. You're still on old.example, chain ID 1."
    )
  })

  it('describes a failed save', () => {
    expect(deepLinkFailureText(new Error('x'), 'config', now)).toBe(
      "Couldn't save the network settings. You're still on old.example, chain ID 1."
    )
  })
})

let scope: EffectScope

async function setup(
  query: LocationQuery,
  extra: { path?: string; hash?: string; paused?: () => boolean } = {}
) {
  route.value = reactive({ path: extra.path ?? '/send', hash: extra.hash ?? '', query }) as never
  scope = effectScope()
  const result = scope.run(() => useDeepLink({ paused: extra.paused }))
  if (!result) throw new Error('scope is inactive')
  await vi.advanceTimersByTimeAsync(0)
  vi.advanceTimersByTime(750)
  return result
}

beforeEach(() => {
  scope?.stop()
  vi.useFakeTimers()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  vi.clearAllMocks()
  calls.log = []
  network.chainId = ref(1) as never
  network.networkId = ref(1) as never
  network.currentNode = ref('wss://old.example:35998') as never
  network.loadConfig.mockImplementation(async () => {
    calls.log.push('loadConfig')
  })
  nodes.rows = ref([]) as never
  nodes.load.mockImplementation(async () => {
    calls.log.push('load')
  })
  nodes.saveEntry.mockImplementation(async (entry: { url: string }) => {
    calls.log.push(`save ${entry.url}`)
  })
  network.selectNode.mockImplementation(async (entry: { url: string }) => {
    calls.log.push(`select ${entry.url}`)
  })
})

describe('useDeepLink', () => {
  it('offers Connect only after the saved settings and node list have loaded', async () => {
    network.loadConfig.mockImplementation(async () => {
      network.currentNode.value = 'wss://custom.example'
      network.chainId.value = 3
      network.networkId.value = 3
    })
    nodes.rows.value = [
      { url: 'wss://custom.example', chainId: 3, networkId: 3 },
      { url: 'wss://main.example', chainId: 1, networkId: 1 },
    ]
    route.value = reactive({
      path: '/send',
      hash: '',
      query: { node: 'wss://main.example' },
    }) as never
    scope = effectScope()
    const link = scope.run(() => useDeepLink())
    if (!link) throw new Error('scope is inactive')
    vi.advanceTimersByTime(2000)
    expect(link.armed.value).toBe(false)
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(750)
    expect(link.armed.value).toBe(true)
    expect(link.preview.value).toMatchObject({ showChainId: true, showNetworkId: true })
    await link.confirm()
    expect(link.failure.value).toBeNull()
    expect(network.selectNode).toHaveBeenCalledWith({
      url: 'wss://main.example',
      chainId: 1,
      networkId: 1,
    })
  })

  it('fails closed when the current IDs change between display and confirm', async () => {
    nodes.rows.value = [{ url: 'wss://main.example', chainId: 1, networkId: 1 }]
    const link = await setup({ node: 'wss://main.example' })
    network.loadConfig.mockImplementation(async () => {
      network.chainId.value = 3
      network.networkId.value = 3
    })
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()
    expect(link.failure.value).toMatch(/changed while this was open/)
  })

  it('disarms Connect when the preview changes until the delay passes again', async () => {
    nodes.rows.value = [{ url: 'wss://main.example', chainId: 1, networkId: 1 }]
    const link = await setup({ node: 'wss://main.example' })
    expect(link.armed.value).toBe(true)

    network.chainId.value = 3
    await nextTick()
    expect(link.armed.value).toBe(false)
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(link.armed.value).toBe(true)
  })

  it('exposes the resolved chain ID of a node-only link before confirm', async () => {
    nodes.rows.value = [{ url: 'wss://test.example', chainId: 3, networkId: 3 }]
    const link = await setup({ node: 'wss://test.example' })
    expect(nodes.load).toHaveBeenCalled()
    expect(link.preview.value).toMatchObject({
      entry: { url: 'wss://test.example', chainId: 3, networkId: 3 },
      showChainId: true,
    })
    expect(network.selectNode).not.toHaveBeenCalled()
  })

  it('fails closed when the node list changes between display and confirm', async () => {
    nodes.rows.value = [{ url: 'wss://test.example', chainId: 3, networkId: 3 }]
    const link = await setup({ node: 'wss://test.example' })
    nodes.load.mockImplementation(async () => {
      nodes.rows.value = [{ url: 'wss://test.example', chainId: 5, networkId: 5 }]
    })
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()
    expect(link.failure.value).toMatch(/changed while this was open/)
    expect(link.request.value).not.toBeNull()
    expect(link.preview.value?.entry.chainId).toBe(5)
  })

  it('restarts the arm delay on focus and on the page becoming visible', async () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    const link = await setup({ chainId: '3' })
    expect(link.armed.value).toBe(true)

    win.dispatchEvent(new Event('focus'))
    expect(link.armed.value).toBe(false)
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()
    vi.advanceTimersByTime(750)
    expect(link.armed.value).toBe(true)

    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(link.armed.value).toBe(true)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(link.armed.value).toBe(false)

    vi.advanceTimersByTime(750)
    expect(link.armed.value).toBe(true)
    scope.stop()
    win.dispatchEvent(new Event('focus'))
    expect(link.armed.value).toBe(true)
  })

  it('starts the arm delay when the dialog becomes visible, not when the link arrives', async () => {
    const paused = ref(true)
    const link = await setup({ chainId: '3' }, { paused: () => paused.value })
    vi.advanceTimersByTime(2000)
    expect(link.armed.value).toBe(false)

    paused.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(link.armed.value).toBe(false)
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(link.armed.value).toBe(true)
    await link.confirm()
    expect(network.selectNode).toHaveBeenCalledWith({ url: OLD, chainId: 3, networkId: 3 })
  })

  it('ignores confirm until the arm delay has passed, and re-arms on a new link', async () => {
    const link = await setup({ chainId: '3' })
    link.cancel()
    route.value.query = { chainId: '4' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    expect(link.armed.value).toBe(false)
    await link.confirm()
    expect(network.selectNode).not.toHaveBeenCalled()

    vi.advanceTimersByTime(750)
    expect(link.armed.value).toBe(true)
    await link.confirm()
    expect(network.selectNode).toHaveBeenCalledWith({ url: OLD, chainId: 4, networkId: 4 })
  })

  it('stays disarmed just before the delay ends', async () => {
    const link = await setup({ chainId: '3' })
    // setup advances 750 ms, so a fresh link shows the boundary.
    route.value.query = { chainId: '4' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(749)
    expect(link.armed.value).toBe(false)
    vi.advanceTimersByTime(1)
    expect(link.armed.value).toBe(true)
  })

  it('restarts the full delay when a new link replaces the request', async () => {
    const link = await setup({ chainId: '3' })
    route.value.query = { chainId: '4' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    vi.advanceTimersByTime(500)
    route.value.query = { chainId: '5' }
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)

    vi.advanceTimersByTime(300)

    expect(link.armed.value).toBe(false)
    vi.advanceTimersByTime(450)
    expect(link.armed.value).toBe(true)
  })

  it('disarms when the request is cleared', async () => {
    const link = await setup({ chainId: '3' })
    expect(link.armed.value).toBe(true)

    link.cancel()

    expect(link.armed.value).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(link.armed.value).toBe(false)
  })

  it('writes nothing when loadConfig fails', async () => {
    const link = await setup({ chainId: '3' })
    network.loadConfig.mockRejectedValue(new Error('read'))

    await link.confirm()

    expect(network.selectNode).not.toHaveBeenCalled()
    expect(link.failure.value).toBe(
      "Couldn't save the network settings. You're still on old.example, chain ID 1."
    )
  })

  it('records a valid link and strips only the three keys', async () => {
    const link = await setup(
      { node: 'wss://a.example', chainId: '3', networkId: '3', keep: 'me' },
      { path: '/send', hash: '#h' }
    )

    expect(link.request.value).toEqual({ node: 'wss://a.example', chainId: 3, networkId: 3 })
    expect(router.replace).toHaveBeenCalledWith({
      path: '/send',
      query: { keep: 'me' },
      hash: '#h',
    })
  })

  it('does nothing for a query with no link keys', async () => {
    const link = await setup({ keep: 'me' })

    expect(link.request.value).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('strips an invalid link and sets no request', async () => {
    const link = await setup({ node: 'javascript:x', chainId: '3', other: '1' })

    expect(link.request.value).toBeNull()
    expect(router.replace).toHaveBeenCalledWith({ path: '/send', query: { other: '1' }, hash: '' })
  })

  it('applies nothing before confirm', async () => {
    await setup({ node: 'wss://a.example', chainId: '3' })

    expect(network.selectNode).not.toHaveBeenCalled()
  })

  it('applies nothing after cancel', async () => {
    const link = await setup({ node: 'wss://a.example', chainId: '3' })

    link.cancel()
    await link.confirm()

    expect(link.request.value).toBeNull()
    expect(network.selectNode).not.toHaveBeenCalled()
  })

  it('confirms in order: loadConfig, load, selectNode, saveEntry, then clears', async () => {
    const link = await setup({ node: 'wss://a.example', chainId: '3', networkId: '4' })

    await link.confirm()

    expect(calls.log).toEqual([
      'loadConfig',
      'load',
      'loadConfig',
      'load',
      'select wss://a.example',
      'save wss://a.example',
    ])
    expect(network.selectNode).toHaveBeenCalledWith({
      url: 'wss://a.example',
      chainId: 3,
      networkId: 4,
    })
    expect(link.request.value).toBeNull()
    expect(link.failure.value).toBeNull()
    expect(toast.show).toHaveBeenCalledWith('Network updated.', 'success')
  })

  it('resolves a chain-only link against the current node and network ID', async () => {
    const link = await setup({ chainId: '3', networkId: '5' })

    await link.confirm()

    expect(network.selectNode).toHaveBeenCalledWith({ url: OLD, chainId: 3, networkId: 5 })
  })

  it('resolves a node-only link from the known entry', async () => {
    nodes.rows.value = [{ url: 'wss://a.example', chainId: 7, networkId: 8 }]
    const link = await setup({ node: 'wss://a.example' })

    await link.confirm()

    expect(network.selectNode).toHaveBeenCalledWith({
      url: 'wss://a.example',
      chainId: 7,
      networkId: 8,
    })
  })

  it('fails before connecting when a built-in node would get other IDs', async () => {
    const link = await setup({ node: 'wss://node.zenonhub.io:35998', chainId: '3' })

    await link.confirm()

    expect(network.selectNode).not.toHaveBeenCalled()
    expect(nodes.saveEntry).not.toHaveBeenCalled()
    expect(link.failure.value).toContain('Built-in nodes use chain ID 1 and network ID 1')
    expect(link.request.value).not.toBeNull()
    expect(link.isConnecting.value).toBe(false)
  })

  it('fails for IDs-only links while on a built-in node', async () => {
    network.currentNode.value = 'wss://node.zenonhub.io:35998'
    const link = await setup({ chainId: '3' })

    await link.confirm()

    expect(network.selectNode).not.toHaveBeenCalled()
    expect(link.failure.value).toContain('Built-in nodes')
  })

  it('connects a built-in node on chain 1 and network 1 and saves nothing special', async () => {
    const link = await setup({ node: 'wss://node.zenonhub.io:35998' })

    await link.confirm()

    expect(network.selectNode).toHaveBeenCalledWith({
      url: 'wss://node.zenonhub.io:35998',
      chainId: 1,
      networkId: 1,
    })
  })

  it('shows the unreachable sentence and saves nothing when selectNode fails', async () => {
    network.chainId.value = 5
    network.selectNode.mockRejectedValue(new Error('unreachable'))
    const link = await setup({ node: 'wss://a.example', chainId: '3' })

    await link.confirm()

    expect(nodes.saveEntry).not.toHaveBeenCalled()
    expect(link.request.value).not.toBeNull()
    expect(link.failure.value).toBe(
      "Couldn't reach that node within 8 seconds. You're still on old.example, chain ID 5."
    )
    expect(toast.show).not.toHaveBeenCalled()
  })

  it('retries on a second confirm after a failure', async () => {
    network.selectNode.mockRejectedValueOnce(new Error('unreachable'))
    const link = await setup({ node: 'wss://a.example', chainId: '3' })

    await link.confirm()
    await link.confirm()

    expect(network.selectNode).toHaveBeenCalledTimes(2)
    expect(link.request.value).toBeNull()
    expect(link.failure.value).toBeNull()
  })

  it('shows the mismatch sentence with the expected chain ID', async () => {
    network.selectNode.mockRejectedValue(new MismatchError(3, 1))
    const link = await setup({ node: 'wss://a.example' })

    await link.confirm()

    expect(nodes.saveEntry).not.toHaveBeenCalled()
    expect(link.failure.value).toContain('That node is on chain ID 3, not chain ID 1.')
  })

  it('clears the request with an error toast when the save fails', async () => {
    nodes.saveEntry.mockRejectedValue(new Error('disk'))
    const link = await setup({ node: 'wss://a.example', chainId: '3' })

    await link.confirm()

    expect(link.request.value).toBeNull()
    expect(link.failure.value).toBeNull()
    expect(toast.show).toHaveBeenCalledWith(
      'Connected, but the node could not be saved to your list.',
      'error'
    )
  })

  it('ignores a second confirm while the first runs', async () => {
    let release: () => void = () => {}
    network.loadConfig.mockImplementationOnce(async () => {})
    network.loadConfig.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const link = await setup({ chainId: '3' })

    const first = link.confirm()
    await link.confirm()
    release()
    await first

    expect(network.selectNode).toHaveBeenCalledTimes(1)
  })

  it('ignores cancel while connecting', async () => {
    let release: () => void = () => {}
    network.loadConfig.mockImplementationOnce(async () => {})
    network.loadConfig.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const link = await setup({ chainId: '3' })

    const pending = link.confirm()
    expect(link.isConnecting.value).toBe(true)
    link.cancel()
    expect(link.request.value).not.toBeNull()
    release()
    await pending
  })

  it('clears request and failure on cancel', async () => {
    network.selectNode.mockRejectedValue(new Error('x'))
    const link = await setup({ node: 'wss://a.example' })
    await link.confirm()
    expect(link.failure.value).not.toBeNull()

    link.cancel()

    expect(link.request.value).toBeNull()
    expect(link.failure.value).toBeNull()
  })

  it('strips a link that arrives while connecting and keeps the request', async () => {
    let release: () => void = () => {}
    network.loadConfig.mockImplementationOnce(async () => {})
    network.loadConfig.mockImplementation(() => new Promise<void>((r) => (release = r)))
    const link = await setup({ chainId: '3' })
    const pending = link.confirm()
    router.replace.mockClear()
    ;(route.value as { query: LocationQuery }).query = { node: 'wss://evil.example', chainId: '9' }
    await Promise.resolve()
    await Promise.resolve()

    expect(router.replace).toHaveBeenCalledWith({ path: '/send', query: {}, hash: '' })
    expect(link.request.value).toEqual({ node: null, chainId: 3, networkId: null })
    release()
    await pending
    expect(network.selectNode).toHaveBeenCalledWith({ url: OLD, chainId: 3, networkId: 3 })
  })
})

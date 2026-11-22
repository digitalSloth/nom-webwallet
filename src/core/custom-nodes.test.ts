import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  STORAGE_KEY_CHAIN_ID,
  STORAGE_KEY_CUSTOM_NODES,
  STORAGE_KEY_NETWORK_ID,
  STORAGE_KEY_SELECTED_NODE,
} from '@/config'

const mocks = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

vi.mock('./storage/storage-service', () => ({
  storageService: {
    get: async (key: string) => (mocks.store.has(key) ? mocks.store.get(key) : null),
    set: async (key: string, value: unknown) => {
      mocks.store.set(key, value)
    },
  },
}))

import { isBuiltInNode, readCustomNodes, writeCustomNodes } from './custom-nodes'

const A = { url: 'wss://a', chainId: 3, networkId: 4 }
const B = { url: 'wss://b', chainId: 5, networkId: 6 }

beforeEach(() => mocks.store.clear())

function persistIds(chainId: number, networkId: number): void {
  mocks.store.set(STORAGE_KEY_CHAIN_ID, chainId)
  mocks.store.set(STORAGE_KEY_NETWORK_ID, networkId)
}

describe('isBuiltInNode', () => {
  it('matches the built-in URLs only', () => {
    expect(isBuiltInNode('wss://node.zenonhub.io:35998')).toBe(true)
    expect(isBuiltInNode('wss://a')).toBe(false)
  })
})

describe('readCustomNodes', () => {
  it('returns an empty list and writes nothing when nothing is stored', async () => {
    expect(await readCustomNodes()).toEqual([])
    expect(mocks.store.has(STORAGE_KEY_CUSTOM_NODES)).toBe(false)
  })

  it('returns stored entries as is without writing', async () => {
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, [A, B])
    expect(await readCustomNodes()).toEqual([A, B])
    expect(mocks.store.get(STORAGE_KEY_CUSTOM_NODES)).toEqual([A, B])
  })

  it('reads an index-keyed object of entries as a list', async () => {
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, { 0: A, 1: B })
    expect(await readCustomNodes()).toEqual([A, B])
  })

  it('migrates URL strings with the persisted IDs and writes the entries back', async () => {
    persistIds(3, 3)
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, ['wss://a', 'wss://b'])
    const expected = [
      { url: 'wss://a', chainId: 3, networkId: 3 },
      { url: 'wss://b', chainId: 3, networkId: 3 },
    ]
    expect(await readCustomNodes()).toEqual(expected)
    expect(mocks.store.get(STORAGE_KEY_CUSTOM_NODES)).toEqual(expected)
  })

  it('migrates an index-keyed object of strings', async () => {
    persistIds(3, 3)
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, { 0: 'wss://a' })
    expect(await readCustomNodes()).toEqual([{ url: 'wss://a', chainId: 3, networkId: 3 }])
  })

  it('migrates with chain 1 and network 1 when no IDs are persisted', async () => {
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, ['wss://a'])
    expect(await readCustomNodes()).toEqual([{ url: 'wss://a', chainId: 1, networkId: 1 }])
  })

  it('keeps entries and migrates strings in a mixed list', async () => {
    persistIds(3, 3)
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, [A, 'wss://b'])
    expect(await readCustomNodes()).toEqual([A, { url: 'wss://b', chainId: 3, networkId: 3 }])
  })

  it('drops invalid elements', async () => {
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, [
      A,
      3,
      null,
      { url: 'wss://x', chainId: 0, networkId: 1 },
      { url: 'wss://y', chainId: 1.5, networkId: 1 },
      { url: 7, chainId: 1, networkId: 1 },
      { url: 'wss://z', chainId: 1 },
    ])
    expect(await readCustomNodes()).toEqual([A])
  })

  it('appends a legacy selected custom node with the persisted IDs', async () => {
    persistIds(3, 3)
    mocks.store.set(STORAGE_KEY_SELECTED_NODE, 'wss://sel')
    const expected = [{ url: 'wss://sel', chainId: 3, networkId: 3 }]
    expect(await readCustomNodes()).toEqual(expected)
    expect(mocks.store.get(STORAGE_KEY_CUSTOM_NODES)).toEqual(expected)
  })

  it('never appends a built-in or already listed selected node', async () => {
    mocks.store.set(STORAGE_KEY_SELECTED_NODE, 'wss://node.zenonhub.io:35998')
    expect(await readCustomNodes()).toEqual([])
    mocks.store.set(STORAGE_KEY_SELECTED_NODE, 'wss://a')
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, ['wss://a'])
    expect(await readCustomNodes()).toHaveLength(1)
  })

  it('returns an empty list for a stored scalar without writing', async () => {
    mocks.store.set(STORAGE_KEY_SELECTED_NODE, 'wss://sel')
    mocks.store.set(STORAGE_KEY_CUSTOM_NODES, 'wss://a')
    expect(await readCustomNodes()).toEqual([])
    expect(mocks.store.get(STORAGE_KEY_CUSTOM_NODES)).toBe('wss://a')
  })
})

describe('writeCustomNodes', () => {
  it('stores plain three-field objects, not the input', async () => {
    const input = [{ ...A, extra: true }]
    await writeCustomNodes(input)
    const stored = mocks.store.get(STORAGE_KEY_CUSTOM_NODES)
    expect(stored).toEqual([A])
    expect(stored).not.toBe(input)
  })
})

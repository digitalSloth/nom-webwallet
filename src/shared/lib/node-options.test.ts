import { describe, expect, it } from 'vitest'

import { CONNECT_TIMEOUT_MS, DEFAULT_NODES } from '@/config'
import { NodeChainMismatchError } from '@/core/composables/useNetwork'

import { nodeFailureText, nodeOptions, parseId, parseNodeUrl } from './node-options'

const ids = (chainId: number, networkId: number) => ({
  chainId,
  networkId,
  ids: `chain ${chainId} · net ${networkId}`,
})
const custom = (url: string, chainId: number, networkId: number) => ({ url, chainId, networkId })

describe('nodeOptions', () => {
  it('lists the built-in nodes as Mainnet on chain 1 and network 1', () => {
    const options = nodeOptions([])

    expect(options.map((o) => o.url)).toEqual(DEFAULT_NODES.map((n) => n.url))
    for (const o of options) {
      expect(o).toMatchObject({ kind: 'Mainnet', custom: false, ...ids(1, 1) })
    }
    expect(options[0].ids).toBe('chain 1 · net 1')
  })

  it('appends custom nodes in order with their own IDs', () => {
    const options = nodeOptions([
      custom('wss://b.example:1', 3, 4),
      custom('wss://a.example:1', 5, 5),
    ])

    expect(options.slice(DEFAULT_NODES.length)).toEqual([
      { url: 'wss://b.example:1', kind: 'Custom', custom: true, ...ids(3, 4) },
      { url: 'wss://a.example:1', kind: 'Custom', custom: true, ...ids(5, 5) },
    ])
  })

  it('lists a custom node equal to a built-in once', () => {
    const options = nodeOptions([{ ...DEFAULT_NODES[1], chainId: 9 }])

    expect(options).toHaveLength(DEFAULT_NODES.length)
    expect(options[1]).toMatchObject({ custom: false, chainId: 1 })
  })

  it('lists a repeated custom node once', () => {
    const options = nodeOptions([
      custom('wss://a.example:1', 3, 3),
      custom('wss://a.example:1', 4, 4),
    ])

    expect(options.filter((o) => o.url === 'wss://a.example:1')).toHaveLength(1)
  })
})

describe('parseNodeUrl', () => {
  it('accepts a wss URL with a host', () => {
    expect(parseNodeUrl('wss://node.zenonhub.io:35998')).toBe('wss://node.zenonhub.io:35998')
  })

  it('returns a ws URL trimmed and otherwise unchanged', () => {
    expect(parseNodeUrl(' ws://127.0.0.1:35997 ')).toBe('ws://127.0.0.1:35997')
  })

  it.each([
    '',
    '   ',
    'http://a.b',
    'https://a.b',
    'node.zenonhub.io',
    'wss://',
    'ws://',
    'wss://a b',
    'javascript:alert(1)',
  ])('rejects %j', (text) => {
    expect(parseNodeUrl(text)).toBeNull()
  })
})

describe('nodeFailureText', () => {
  it('describes a chain mismatch', () => {
    expect(
      nodeFailureText('wss://x.example:1', new NodeChainMismatchError(3, 1), DEFAULT_NODES[0].url)
    ).toBe('That node is on chain ID 3, not chain ID 1. Still using node.zenonhub.io.')
  })

  it('describes an unreachable node with the current host', () => {
    const text = nodeFailureText(
      'wss://x.example:1',
      new Error('boom'),
      'wss://current.example:35998'
    )

    expect(text).toBe(
      `Couldn't reach wss://x.example:1 within ${CONNECT_TIMEOUT_MS / 1000} seconds. Still using current.example.`
    )
  })
})

describe('parseId', () => {
  it('accepts positive whole-number text', () => {
    expect(parseId('3')).toBe(3)
    expect(parseId('12')).toBe(12)
  })

  it.each([
    '0',
    '-1',
    '3abc',
    '1.5',
    '',
    '9007199254740993',
    '03',
    ' 3',
    '1e3',
    3,
    null,
    undefined,
  ])('rejects %s', (id) => {
    expect(parseId(id)).toBeNull()
  })
})

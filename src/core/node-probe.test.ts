import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { probeChainId } from './node-probe'

type Handler = (event: unknown) => void

class FakeSocket {
  static instances: FakeSocket[] = []
  static throwOnConstruct = false
  handlers: Record<string, Handler[]> = {}
  sent: string[] = []
  closed = false

  constructor(readonly url: string) {
    if (FakeSocket.throwOnConstruct) throw new Error('bad url')
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, handler: Handler): void {
    ;(this.handlers[type] ??= []).push(handler)
  }
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
  emit(type: string, event: unknown = {}): void {
    for (const handler of this.handlers[type] ?? []) handler(event)
  }
}

const socket = () => FakeSocket.instances[0]
const answer = (body: unknown) => socket().emit('message', { data: JSON.stringify(body) })

beforeEach(() => {
  FakeSocket.instances = []
  FakeSocket.throwOnConstruct = false
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('probeChainId', () => {
  it('asks for the frontier momentum and resolves its chain ID, then closes', async () => {
    const result = probeChainId('wss://n')
    socket().emit('open')
    expect(JSON.parse(socket().sent[0])).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'ledger.getFrontierMomentum',
      params: [],
    })
    answer({ jsonrpc: '2.0', id: 1, result: { chainIdentifier: 3 } })
    await expect(result).resolves.toBe(3)
    expect(socket().closed).toBe(true)
  })

  it('rejects after the timeout and closes', async () => {
    const result = probeChainId('wss://n', 1000)
    const assertion = expect(result).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(socket().closed).toBe(true)
  })

  it('rejects on a socket error', async () => {
    const result = probeChainId('wss://n')
    socket().emit('error')
    await expect(result).rejects.toThrow()
    expect(socket().closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects when the socket closes before an answer', async () => {
    const result = probeChainId('wss://n')
    socket().emit('close')
    await expect(result).rejects.toThrow()
    expect(socket().closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    ['a JSON-RPC error', { id: 1, error: { code: -1 } }],
    ['no chain ID', { id: 1, result: {} }],
    ['a zero chain ID', { id: 1, result: { chainIdentifier: 0 } }],
    ['a decimal chain ID', { id: 1, result: { chainIdentifier: 1.5 } }],
    ['a string chain ID', { id: 1, result: { chainIdentifier: '3' } }],
  ])('rejects on %s', async (_name, body) => {
    const result = probeChainId('wss://n')
    answer(body)
    await expect(result).rejects.toThrow()
    expect(socket().closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects on a non-JSON message', async () => {
    const result = probeChainId('wss://n')
    socket().emit('message', { data: 'nope' })
    await expect(result).rejects.toThrow()
    expect(socket().closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects when the constructor throws', async () => {
    FakeSocket.throwOnConstruct = true
    await expect(probeChainId('nope')).rejects.toThrow('bad url')
  })

  it('settles once: a later close does not change the result', async () => {
    const result = probeChainId('wss://n')
    answer({ id: 1, result: { chainIdentifier: 2 } })
    socket().emit('close')
    await expect(result).resolves.toBe(2)
  })
})

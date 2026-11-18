import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = ((event: never) => void) | null

/** Stands in for the browser Worker; each test drives it by hand. */
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: Listener = null
  onerror: Listener = null
  posted: { id: number; hashHex: string; difficulty: number }[] = []
  terminated = false

  constructor(
    public url: string,
    public options: WorkerOptions
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(message: { id: number; hashHex: string; difficulty: number }) {
    this.posted.push(message)
  }

  terminate() {
    this.terminated = true
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as never)
  }

  fail(message = '') {
    this.onerror?.({ message, preventDefault() {} } as never)
  }
}

async function load() {
  vi.resetModules()
  return (await import('./web-pow-provider')).webPowProvider
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('webPowProvider', () => {
  it('runs PoW in /pow-worker.js as a module worker and resolves with the nonce', async () => {
    const pow = await load()
    const result = pow('ab'.repeat(32), 1000)
    const [worker] = FakeWorker.instances
    expect(worker.url).toBe('/pow-worker.js')
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.posted).toEqual([{ id: 1, hashHex: 'ab'.repeat(32), difficulty: 1000 }])

    worker.reply({ id: 1, nonce: '00112233aabbccdd' })
    await expect(result).resolves.toBe('00112233aabbccdd')
  })

  it('reuses one worker and matches replies by id', async () => {
    const pow = await load()
    const first = pow('aa', 1)
    const second = pow('bb', 2)
    expect(FakeWorker.instances).toHaveLength(1)
    const [worker] = FakeWorker.instances
    worker.reply({ id: 2, nonce: '02' })
    worker.reply({ id: 1, nonce: '01' })
    await expect(first).resolves.toBe('01')
    await expect(second).resolves.toBe('02')
  })

  it('rejects an error reply or a nonce that is not hex', async () => {
    const pow = await load()
    const failed = pow('aa', 1)
    const garbage = pow('bb', 1)
    const [worker] = FakeWorker.instances
    worker.reply({ id: 1, error: 'Invalid PoW request' })
    worker.reply({ id: 2, nonce: 'not-hex' })
    await expect(failed).rejects.toThrow('PoW failed: Invalid PoW request')
    await expect(garbage).rejects.toThrow('PoW failed: invalid result')
  })

  it('fails every pending request when the worker cannot load, then starts a new one', async () => {
    const pow = await load()
    const a = pow('aa', 1)
    const b = pow('bb', 1)
    const [broken] = FakeWorker.instances
    broken.fail()
    await expect(a).rejects.toThrow('PoW worker error: failed to load')
    await expect(b).rejects.toThrow('PoW worker error: failed to load')
    expect(broken.terminated).toBe(true)

    const retry = pow('cc', 1)
    expect(FakeWorker.instances).toHaveLength(2)
    FakeWorker.instances[1].reply({ id: 3, nonce: 'ff' })
    await expect(retry).resolves.toBe('ff')
  })

  it('times out after twenty minutes and drops the stuck worker', async () => {
    vi.useFakeTimers()
    const pow = await load()
    const stuck = pow('aa', 1)
    const [worker] = FakeWorker.instances
    vi.advanceTimersByTime(20 * 60_000 - 1)
    expect(worker.terminated).toBe(false)
    vi.advanceTimersByTime(1)
    await expect(stuck).rejects.toThrow('PoW timed out')
    expect(worker.terminated).toBe(true)

    void pow('bb', 1)
    expect(FakeWorker.instances).toHaveLength(2)
  })
})

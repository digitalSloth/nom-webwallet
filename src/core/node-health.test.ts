import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NODE_RETRY_MS } from '@/config'

type Health = typeof import('./node-health')
let health: Health

beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  health = await import('./node-health')
})

describe('node health flag', () => {
  it('a failure sets nodeDown and a success clears it', () => {
    expect(health.nodeDown.value).toBe(false)

    health.reportNodeFailure()
    expect(health.nodeDown.value).toBe(true)

    health.reportNodeSuccess()
    expect(health.nodeDown.value).toBe(false)
  })
})

describe('node retry', () => {
  it('does not run the probe while the node is up', async () => {
    const probe = vi.fn(async () => {})
    health.startNodeRetry(probe)

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS * 3)

    expect(probe).not.toHaveBeenCalled()
  })

  it('does not run without a started probe, even while down', async () => {
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS * 3)

    expect(health.nodeDown.value).toBe(true)
  })

  it('runs the probe every interval while down', async () => {
    const probe = vi.fn(async () => {})
    health.startNodeRetry(probe)
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS - 1)
    expect(probe).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(probe).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('starts the loop when the probe is registered after the failure', async () => {
    const probe = vi.fn(async () => {})
    health.reportNodeFailure()
    health.startNodeRetry(probe)

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('does not start a probe again until the running one settles', async () => {
    let release: () => void = () => {}
    const probe = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    health.startNodeRetry(probe)
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS * 3)
    expect(probe).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('stops running after a success', async () => {
    const probe = vi.fn(async () => {})
    health.startNodeRetry(probe)
    health.reportNodeFailure()
    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)
    expect(probe).toHaveBeenCalledTimes(1)

    health.reportNodeSuccess()
    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS * 3)

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('keeps one loop and the first probe when started twice', async () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    health.startNodeRetry(first)
    health.startNodeRetry(second)
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('keeps the loop alive when the probe rejects', async () => {
    const probe = vi.fn(async () => {
      throw new Error('still down')
    })
    health.startNodeRetry(probe)
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS * 3)

    expect(probe).toHaveBeenCalledTimes(3)
    expect(health.nodeDown.value).toBe(true)
  })

  it('a repeated failure does not add a second timer', async () => {
    const probe = vi.fn(async () => {})
    health.startNodeRetry(probe)
    health.reportNodeFailure()
    health.reportNodeFailure()

    await vi.advanceTimersByTimeAsync(NODE_RETRY_MS)

    expect(probe).toHaveBeenCalledTimes(1)
  })
})

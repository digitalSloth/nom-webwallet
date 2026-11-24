import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { APPROVAL_WINDOW_IDLE_MS } from '@/config'

import { ACTIVITY_EVENTS, IDLE_CHECK_INTERVAL_MS, createIdleWatch } from './idle-watch'

class SpyTarget extends EventTarget {
  added: string[] = []
  removed: string[] = []
  captureFlags: unknown[] = []
  override addEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    opts?: boolean | AddEventListenerOptions
  ): void {
    this.added.push(type)
    this.captureFlags.push(opts)
    super.addEventListener(type, cb, opts)
  }
  override removeEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    opts?: boolean | EventListenerOptions
  ): void {
    this.removed.push(type)
    super.removeEventListener(type, cb, opts)
  }
}

function trustedEvent(name: string): Event {
  const event = new Event(name)
  Object.defineProperty(event, 'isTrusted', { value: true })
  return event
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createIdleWatch', () => {
  it('calls onIdle once the idle limit passes without input', () => {
    const onIdle = vi.fn()
    const watch = createIdleWatch({ onIdle, target: new EventTarget() })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it.each([...ACTIVITY_EVENTS])('resets the idle clock on %s', (name) => {
    const onIdle = vi.fn()
    const target = new EventTarget()
    const watch = createIdleWatch({ onIdle, target })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    target.dispatchEvent(trustedEvent(name))
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).not.toHaveBeenCalled()

    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it.each([...ACTIVITY_EVENTS])('ignores an untrusted %s event', (name) => {
    const onIdle = vi.fn()
    const target = new EventTarget()
    const watch = createIdleWatch({ onIdle, target })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    target.dispatchEvent(new Event(name))
    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS)

    expect(onIdle).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('listens in the capture phase with passive listeners', () => {
    const target = new SpyTarget()
    const watch = createIdleWatch({ onIdle: vi.fn(), target })
    watch.start()

    expect(target.added.sort()).toEqual([...ACTIVITY_EVENTS].sort())
    for (const opts of target.captureFlags) {
      expect(opts).toEqual({ capture: true, passive: true })
    }
    watch.stop()
  })

  it('touch() counts as activity', () => {
    const onIdle = vi.fn()
    const watch = createIdleWatch({ onIdle, target: new EventTarget() })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    watch.touch()
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).not.toHaveBeenCalled()
    watch.stop()
  })

  it('does not call onIdle while isBusy() is true, then fires once it clears', () => {
    const onIdle = vi.fn()
    let busy = true
    const watch = createIdleWatch({ onIdle, isBusy: () => busy, target: new EventTarget() })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()

    busy = false
    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    watch.stop()
  })

  it('restarts the idle clock after each onIdle call', () => {
    const onIdle = vi.fn()
    const watch = createIdleWatch({ onIdle, target: new EventTarget() })
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).toHaveBeenCalledTimes(2)
    watch.stop()
  })

  it('stop() clears the timer and removes every listener', () => {
    const onIdle = vi.fn()
    const target = new SpyTarget()
    const watch = createIdleWatch({ onIdle, target })
    watch.start()
    watch.stop()

    expect(target.removed.sort()).toEqual([...ACTIVITY_EVENTS].sort())
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS * 2)
    expect(onIdle).not.toHaveBeenCalled()
  })

  it('stop() without start() does nothing', () => {
    const target = new SpyTarget()
    const watch = createIdleWatch({ onIdle: vi.fn(), target })
    watch.stop()
    expect(target.removed).toEqual([])
  })

  it('start() twice keeps one timer and one set of listeners', () => {
    const onIdle = vi.fn()
    const target = new SpyTarget()
    const watch = createIdleWatch({ onIdle, target })
    watch.start()
    watch.start()

    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS)
    expect(onIdle).toHaveBeenCalledTimes(1)
    watch.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restarts the idle clock when start() is called again after stop()', () => {
    const onIdle = vi.fn()
    const watch = createIdleWatch({ onIdle, target: new EventTarget() })
    watch.start()
    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    watch.stop()
    watch.start()

    vi.advanceTimersByTime(APPROVAL_WINDOW_IDLE_MS - IDLE_CHECK_INTERVAL_MS)
    expect(onIdle).not.toHaveBeenCalled()
    watch.stop()
  })
})

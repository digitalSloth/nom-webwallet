import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, type EffectScope } from 'vue'

// Vue is imported above, before `document` is stubbed (it touches it at import).
const { useTimedReveal } = await import('./timed-reveal')

let doc: EventTarget & { visibilityState: string }
let scope: EffectScope

function setup(ms = 60_000) {
  scope = effectScope()
  const result = scope.run(() => useTimedReveal(ms))
  if (!result) throw new Error('scope is inactive')
  return result
}

function setVisibility(state: 'visible' | 'hidden'): void {
  doc.visibilityState = state
  doc.dispatchEvent(new Event('visibilitychange'))
}

function deferred() {
  let resolve!: (v: string) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', doc)
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useTimedReveal', () => {
  it('shows the value after the load and clears it at 60 s, not before', async () => {
    const t = setup()

    await t.reveal(async () => 'secret')
    expect(t.value.value).toBe('secret')

    vi.advanceTimersByTime(59_999)
    expect(t.value.value).toBe('secret')
    vi.advanceTimersByTime(1)
    expect(t.value.value).toBeNull()
  })

  it('clears on hide()', async () => {
    const t = setup()
    await t.reveal(async () => 'secret')

    t.hide()

    expect(t.value.value).toBeNull()
  })

  it('clears when the scope stops', async () => {
    const t = setup()
    await t.reveal(async () => 'secret')

    scope.stop()

    expect(t.value.value).toBeNull()
  })

  it('restarts the timer on a second reveal', async () => {
    const t = setup()
    await t.reveal(async () => 'one')
    vi.advanceTimersByTime(30_000)
    await t.reveal(async () => 'two')

    vi.advanceTimersByTime(59_999)
    expect(t.value.value).toBe('two')
    vi.advanceTimersByTime(1)
    expect(t.value.value).toBeNull()
  })

  it('discards a load that finishes after hide()', async () => {
    const t = setup()
    const load = deferred()
    const pending = t.reveal(() => load.promise)

    t.hide()
    load.resolve('secret')
    await pending

    expect(t.value.value).toBeNull()
  })

  it('discards a load that finishes after the scope stops', async () => {
    const t = setup()
    const load = deferred()
    const pending = t.reveal(() => load.promise)

    scope.stop()
    load.resolve('secret')
    await pending

    expect(t.value.value).toBeNull()
  })

  it('clears when the document turns hidden', async () => {
    const t = setup()
    await t.reveal(async () => 'secret')

    setVisibility('hidden')

    expect(t.value.value).toBeNull()
  })

  it('discards a load that resolves while the tab is hidden', async () => {
    const t = setup()
    const load = deferred()
    const pending = t.reveal(() => load.promise)

    setVisibility('hidden')
    load.resolve('secret')
    await pending

    expect(t.value.value).toBeNull()
  })

  it('discards a load that resolves while hidden even after the tab is visible again', async () => {
    const t = setup()
    const load = deferred()
    const pending = t.reveal(() => load.promise)

    setVisibility('hidden')
    setVisibility('visible')
    load.resolve('secret')
    await pending

    expect(t.value.value).toBeNull()
  })

  it('discards a load that resolves while the document is hidden with no event seen', async () => {
    const t = setup()
    const load = deferred()
    const pending = t.reveal(() => load.promise)

    doc.visibilityState = 'hidden'
    load.resolve('secret')
    await pending

    expect(t.value.value).toBeNull()
  })

  it('rejects when the load rejects and leaves the value null', async () => {
    const t = setup()

    await expect(
      t.reveal(async () => Promise.reject(new Error('Invalid password')))
    ).rejects.toThrow('Invalid password')
    expect(t.value.value).toBeNull()
  })

  it('stops reacting to visibility after the scope stops', async () => {
    const t = setup()
    scope.stop()
    await t.reveal(async () => 'later')

    setVisibility('hidden')

    expect(t.value.value).toBe('later')
    t.hide()
  })
})

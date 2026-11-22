import { beforeEach, describe, expect, it, vi } from 'vitest'

import { installFakeWeb } from '@/test/fake-web'

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  suspend: vi.fn(),
  releaseLock: null as null | (() => void),
  suspendLock: vi.fn(),
  resumeLock: vi.fn(),
}))

vi.mock('@/core/composables/useNetwork', () => ({
  configureNetwork: (o: unknown) => mocks.calls.push(`network:${JSON.stringify(o)}`),
}))
vi.mock('@/core/composables/useTxTracker', () => ({
  configureTxTracker: (o: unknown) => mocks.calls.push(`tracker:${JSON.stringify(o)}`),
}))
vi.mock('@/core/composables/useInterruptedSends', () => ({
  configureInterruptedSends: () => mocks.calls.push('interrupted'),
}))
vi.mock('@/core/local-send-recorder', () => ({
  createLocalSendRecorder: () => 'recorder',
  localInterruptedSource: {},
  suspendTabLock: mocks.suspendLock,
  resumeTabLock: mocks.resumeLock,
  startTabLock: async () => {
    mocks.calls.push('lock')
    await new Promise<void>((resolve) => (mocks.releaseLock = resolve))
    mocks.calls.push('lock-granted')
  },
}))
vi.mock('@/core/send-recorder', () => ({
  setSendRecorder: () => mocks.calls.push('recorder'),
}))
vi.mock('@/core/transaction-service', () => ({ suspendPendingPublishes: mocks.suspend }))
vi.mock('@/core/web-session', () => ({
  startWebSession: async () => {
    mocks.calls.push('session')
  },
}))

import { initWebDocument } from './init'

beforeEach(() => {
  mocks.calls.length = 0
  mocks.suspend.mockReset()
  mocks.suspendLock.mockReset()
  mocks.resumeLock.mockReset()
  installFakeWeb()
})

function pagehide(persisted: boolean): void {
  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted }))
}

function pageshow(persisted: boolean): void {
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted }))
}

describe('initWebDocument', () => {
  it('takes the tab lock before installing the recorder, and starts the session last', async () => {
    const done = initWebDocument()
    await Promise.resolve()
    expect(mocks.calls).not.toContain('recorder')

    mocks.releaseLock?.()
    await done

    expect(mocks.calls).toEqual([
      'network:{"nodeRetry":true}',
      'tracker:{"toasts":false,"followRecipient":true}',
      'lock',
      'lock-granted',
      'recorder',
      'interrupted',
      'session',
    ])
  })

  it('suspends pending publishes when the page enters the back/forward cache', async () => {
    const done = initWebDocument()
    mocks.releaseLock?.()
    await done

    pagehide(true)

    expect(mocks.suspend).toHaveBeenCalledTimes(1)
  })

  it('does not suspend when the page is unloaded for good', async () => {
    const done = initWebDocument()
    mocks.releaseLock?.()
    await done

    pagehide(false)

    expect(mocks.suspend).not.toHaveBeenCalled()
  })

  it('drops the tab lock claim on a cache entry and re-checks it on a cache restore', async () => {
    const done = initWebDocument()
    mocks.releaseLock?.()
    await done

    pagehide(true)
    expect(mocks.suspendLock).toHaveBeenCalledTimes(1)
    pageshow(false)
    expect(mocks.resumeLock).not.toHaveBeenCalled()
    pageshow(true)
    expect(mocks.resumeLock).toHaveBeenCalledTimes(1)
  })
})

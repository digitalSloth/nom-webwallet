import { describe, expect, it } from 'vitest'

import { runActivity } from './composables/useActivity'
import { beginActivity, holdSendLock, isSendBusy, sendStep } from './send-status'

describe('holdSendLock', () => {
  it('keeps isSendBusy true while the task runs and clears it after', async () => {
    let release!: () => void
    const held = holdSendLock(() => new Promise<void>((resolve) => (release = resolve)))
    expect(isSendBusy.value).toBe(true)
    release()
    await held
    expect(isSendBusy.value).toBe(false)
  })

  it('clears isSendBusy after the task rejects and rethrows to the caller', async () => {
    await expect(holdSendLock(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom'
    )
    expect(isSendBusy.value).toBe(false)
  })
})

describe('sendStep', () => {
  it('falls back to the generic label with no activity', () => {
    expect(sendStep.value).toBe('Sending transaction')
  })

  it('shows the newest step and returns to the outer step when the inner one ends', () => {
    const outer = beginActivity('Outer')
    const inner = beginActivity('Inner')
    expect(sendStep.value).toBe('Inner')
    inner.end()
    expect(sendStep.value).toBe('Outer')
    outer.end()
    expect(sendStep.value).toBe('Sending transaction')
  })
})

describe('beginActivity', () => {
  it('makes isSendBusy true until the activity ends', () => {
    const a = beginActivity('A')
    expect(isSendBusy.value).toBe(true)
    a.end()
    expect(isSendBusy.value).toBe(false)
  })

  it('setStep updates only its own entry', () => {
    const a = beginActivity('A')
    const b = beginActivity('B')
    a.setStep('A2')
    expect(sendStep.value).toBe('B')
    b.end()
    expect(sendStep.value).toBe('A2')
    a.end()
  })

  it('a second end() changes nothing', () => {
    const a = beginActivity('A')
    const b = beginActivity('B')
    a.end()
    a.end()
    expect(isSendBusy.value).toBe(true)
    expect(sendStep.value).toBe('B')
    b.end()
    expect(isSendBusy.value).toBe(false)
  })
})

describe('runActivity', () => {
  it('shows the step while running and returns the result', async () => {
    const result = await runActivity('Working', async ({ setStep }) => {
      expect(sendStep.value).toBe('Working')
      setStep('Still working')
      expect(sendStep.value).toBe('Still working')
      return 42
    })
    expect(result).toBe(42)
    expect(isSendBusy.value).toBe(false)
  })

  it('removes its step when the callback rejects', async () => {
    await expect(runActivity('Working', async () => Promise.reject(new Error('nope')))).rejects.toThrow(
      'nope'
    )
    expect(isSendBusy.value).toBe(false)
    expect(sendStep.value).toBe('Sending transaction')
  })
})

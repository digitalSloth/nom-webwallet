import { effectScope, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { hasUnresolvedSend, trackUnresolvedSend } from './unresolved-send'

describe('trackUnresolvedSend', () => {
  it('is unresolved while the outcome is unknown and the page is mounted', () => {
    const outcome = ref(false)
    const scope = effectScope()
    scope.run(() => trackUnresolvedSend(outcome))
    expect(hasUnresolvedSend.value).toBe(false)

    outcome.value = true
    expect(hasUnresolvedSend.value).toBe(true)

    scope.stop()
    expect(hasUnresolvedSend.value).toBe(false)
  })

  it('counts each page once and releases only its own', () => {
    const a = ref(true)
    const b = ref(true)
    const scopeA = effectScope()
    const scopeB = effectScope()
    scopeA.run(() => trackUnresolvedSend(a))
    scopeB.run(() => trackUnresolvedSend(b))

    scopeA.stop()
    expect(hasUnresolvedSend.value).toBe(true)
    scopeB.stop()
    expect(hasUnresolvedSend.value).toBe(false)
  })

  it('releases when the outcome clears', () => {
    const outcome = ref(true)
    const scope = effectScope()
    scope.run(() => trackUnresolvedSend(outcome))
    outcome.value = false
    expect(hasUnresolvedSend.value).toBe(false)
    scope.stop()
  })
})

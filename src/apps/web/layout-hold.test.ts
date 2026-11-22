import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { trackSend } from '@/shared/lib/unresolved-send'

const busy = ref(false)
vi.mock('@/core', () => ({ isSendBusy: busy }))

const { useLayout } = await import('./layout-hold')

const route = { name: 'send', matched: [{ components: { small: {}, large: {} } }] } as never

describe('useLayout', () => {
  beforeEach(() => {
    busy.value = false
  })

  it('keeps the large layout across a flip while a send is busy, then flips', () => {
    const phone = ref(false)
    const scope = effectScope()
    const layout = scope.run(() => useLayout(route, phone)) ?? ref('large')
    expect(layout.value).toBe('large')

    busy.value = true
    phone.value = true
    expect(layout.value).toBe('large')

    busy.value = false
    expect(layout.value).toBe('small')
    scope.stop()
  })

  it('keeps the layout when a send times out after the busy flag clears during a flip', async () => {
    const phone = ref(false)
    const submitting = ref(false)
    const unknownOutcome = ref(false)
    const scope = effectScope()
    const layout =
      scope.run(() => {
        trackSend(submitting, unknownOutcome)
        return useLayout(route, phone)
      }) ?? ref('large')
    expect(layout.value).toBe('large')

    submitting.value = true
    busy.value = true
    phone.value = true
    expect(layout.value).toBe('large')

    // holdSendLock clears first, then the page records the timeout.
    busy.value = false
    await nextTick()
    expect(layout.value).toBe('large')
    unknownOutcome.value = true
    submitting.value = false
    expect(layout.value).toBe('large')

    scope.stop()
    expect(layout.value).toBe('small')
  })
})

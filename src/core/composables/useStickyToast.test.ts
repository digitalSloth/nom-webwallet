import { describe, expect, it, vi } from 'vitest'
import { useStickyToast } from './useStickyToast'

function host() {
  let next = 0
  return {
    error: vi.fn(() => ++next),
    dismiss: vi.fn(),
  }
}

describe('useStickyToast', () => {
  it('shows an error that never times out and has a close button', () => {
    const h = host()

    useStickyToast(h).showError('refused')

    expect(h.error).toHaveBeenCalledWith('refused', { duration: Infinity, closeButton: true })
  })

  it('dismisses the shown toast', () => {
    const h = host()
    const sticky = useStickyToast(h)
    sticky.showError('refused')

    sticky.dismiss()

    expect(h.dismiss).toHaveBeenCalledWith(1)
  })

  it('dismisses nothing when no toast is shown', () => {
    const h = host()
    const sticky = useStickyToast(h)

    sticky.dismiss()
    sticky.showError('refused')
    sticky.dismiss()
    sticky.dismiss()

    expect(h.dismiss).toHaveBeenCalledTimes(1)
  })

  it('replaces the previous toast instead of stacking', () => {
    const h = host()
    const sticky = useStickyToast(h)

    sticky.showError('first')
    sticky.showError('second')

    expect(h.dismiss).toHaveBeenCalledWith(1)
  })
})

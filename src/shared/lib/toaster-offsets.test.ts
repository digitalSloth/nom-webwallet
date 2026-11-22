import { describe, expect, it } from 'vitest'
import { offsetsFor, toasterOffsets } from './toaster-offsets'

describe('toasterOffsets', () => {
  it('clears the tab bar when it is shown', () => {
    expect(toasterOffsets(true)).toEqual({
      offset: {
        bottom: 'calc(76px + env(safe-area-inset-bottom))',
        right: 'calc(24px + env(safe-area-inset-right))',
      },
      mobileOffset: { bottom: '76px' },
    })
  })

  it('keeps the 24px corner without the tab bar and sets no mobileOffset', () => {
    const result = toasterOffsets(false)

    expect(result).toEqual({
      offset: {
        bottom: 'calc(24px + env(safe-area-inset-bottom))',
        right: 'calc(24px + env(safe-area-inset-right))',
      },
    })
    expect('mobileOffset' in result).toBe(false)
  })

  it('lifts the stack over the transaction toast above the tab bar', () => {
    expect(toasterOffsets(true, true)).toEqual({
      offset: {
        bottom: 'calc(172px + env(safe-area-inset-bottom))',
        right: 'calc(24px + env(safe-area-inset-right))',
      },
      mobileOffset: { bottom: '172px' },
    })
  })

  it('ignores the transaction toast without the tab bar', () => {
    expect(toasterOffsets(false, true)).toEqual(toasterOffsets(false))
  })
})

describe('toasterOffsets framed', () => {
  it('measures from the frame bottom when the viewport is taller than the frame', () => {
    const value = 'max(76px, calc(50vh - 224px))'
    expect(toasterOffsets(true, false, true)).toEqual({
      offset: { bottom: value, right: 'calc(24px + env(safe-area-inset-right))' },
      mobileOffset: { bottom: value },
    })
  })

  it('adds the transaction toast lift', () => {
    const value = 'max(172px, calc(50vh - 128px))'
    expect(toasterOffsets(true, true, true).mobileOffset).toEqual({ bottom: value })
  })

  it('ignores the frame without the tab bar', () => {
    expect(toasterOffsets(false, false, true)).toEqual(toasterOffsets(false))
  })
})

describe('offsetsFor', () => {
  const base = { hostBar: true, routeTabBar: true, routeName: 'home', txToastShown: false }

  it('lets the host veto the bar', () => {
    expect(offsetsFor({ ...base, hostBar: false })).toEqual(toasterOffsets(false))
  })

  it('shows no bar offset on a route without the tab bar', () => {
    expect(offsetsFor({ ...base, routeTabBar: false, txToastShown: true })).toEqual(
      toasterOffsets(false)
    )
  })

  it('does not lift for a transaction toast off Home', () => {
    expect(offsetsFor({ ...base, routeName: 'activity', txToastShown: true })).toEqual(
      toasterOffsets(true)
    )
  })

  it('lifts on Home only while the transaction toast shows', () => {
    expect(offsetsFor({ ...base, txToastShown: true })).toEqual(toasterOffsets(true, true))
    expect(offsetsFor(base)).toEqual(toasterOffsets(true))
  })

  it('passes the framed flag through', () => {
    expect(offsetsFor({ ...base, framed: true })).toEqual(toasterOffsets(true, false, true))
  })
})

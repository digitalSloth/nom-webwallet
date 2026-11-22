import { afterEach, describe, expect, it, vi } from 'vitest'
import { PHONE_QUERY, isPhoneLayout } from './breakpoint'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PHONE_QUERY', () => {
  it('is the 901px width query', () => {
    expect(PHONE_QUERY).toBe('(width < 901px)')
  })
})

describe('isPhoneLayout', () => {
  it('is false without a window', () => {
    expect(isPhoneLayout()).toBe(false)
  })

  it('is false when window has no matchMedia', () => {
    vi.stubGlobal('window', {})

    expect(isPhoneLayout()).toBe(false)
  })

  it.each([true, false])('returns matches=%s from matchMedia(PHONE_QUERY)', (matches) => {
    const matchMedia = vi.fn(() => ({ matches }))
    vi.stubGlobal('window', { matchMedia })

    expect(isPhoneLayout()).toBe(matches)
    expect(matchMedia).toHaveBeenCalledWith(PHONE_QUERY)
  })
})

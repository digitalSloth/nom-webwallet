import { describe, expect, it } from 'vitest'
import { fallbackFor, heldLayout, layoutFor, WIDE_SCREEN_NOTICE } from './layout-fallback'

type Views = ('small' | 'large')[]

function route(name: string, views: Views) {
  const components = Object.fromEntries(views.map((v) => [v, {}]))
  return { name, matched: [{ components }] } as never
}

describe('fallbackFor', () => {
  it('has no fallback when the route has a view for the layout', () => {
    expect(fallbackFor(route('home', ['small', 'large']), 'small')).toBeNull()
    expect(fallbackFor(route('home', ['small', 'large']), 'large')).toBeNull()
  })

  it('has no fallback before the first navigation', () => {
    expect(fallbackFor({ name: undefined, matched: [] }, 'small')).toBeNull()
  })

  it("sends /activity on the small layout to Home's Activity tab with no notice", () => {
    expect(fallbackFor(route('activity', ['large']), 'small')).toEqual({
      to: { name: 'home', query: { tab: 'activity' } },
      notice: null,
    })
  })

  it.each(['pillars', 'staking', 'tokens', 'token-issue'])(
    'sends %s on the small layout to Home with the wide-screen notice',
    (name) => {
      expect(fallbackFor(route(name, ['large']), 'small')).toEqual({
        to: { name: 'home' },
        notice: WIDE_SCREEN_NOTICE,
      })
    }
  )

  it('sends Send review on the large layout to Send', () => {
    expect(fallbackFor(route('send-review', ['small']), 'large')).toEqual({
      to: { name: 'send' },
      notice: null,
    })
  })

  it.each(['settings', 'manage-wallet', 'export-phrase', 'change-password', 'remove-wallet'])(
    'sends %s on the large layout to the wallets tab',
    (name) => {
      expect(fallbackFor(route(name, ['small']), 'large')).toEqual({
        to: { name: 'settings-wallets' },
        notice: null,
      })
    }
  )
})

describe('fallbackFor with unmapped names', () => {
  it('sends an unknown small-only route on the large layout to Home', () => {
    expect(fallbackFor(route('other', ['small']), 'large')).toEqual({
      to: { name: 'home' },
      notice: null,
    })
  })

  it('sends an unknown large-only route on the small layout to Home with the notice', () => {
    expect(fallbackFor(route('other', ['large']), 'small')).toEqual({
      to: { name: 'home' },
      notice: WIDE_SCREEN_NOTICE,
    })
  })

  it('returns null for a route with a view in the layout, whatever its name', () => {
    expect(fallbackFor(route('send-review', ['small']), 'small')).toBeNull()
    expect(fallbackFor(route('activity', ['large']), 'large')).toBeNull()
  })
})

describe('layoutFor', () => {
  it('renders the layout the width asks for when the route has its view', () => {
    const both = route('home', ['small', 'large'])

    expect(layoutFor(both, true)).toBe('small')
    expect(layoutFor(both, false)).toBe('large')
  })

  it('renders the other layout when the route only has that one', () => {
    expect(layoutFor(route('pillars', ['large']), true)).toBe('large')
    expect(layoutFor(route('send-review', ['small']), false)).toBe('small')
  })

  it('renders the asked layout for a route with neither', () => {
    const none = { name: undefined, matched: [] } as never

    expect(layoutFor(none, true)).toBe('small')
    expect(layoutFor(none, false)).toBe('large')
  })
})

describe('heldLayout', () => {
  const both = route('send', ['small', 'large'])

  it('keeps the rendered layout over the width while held', () => {
    expect(heldLayout(both, 'small', 'large', true)).toBe('large')
  })

  it('follows the width when not held or nothing rendered yet', () => {
    expect(heldLayout(both, 'small', 'large', false)).toBe('small')
    expect(heldLayout(both, 'small', null, true)).toBe('small')
  })

  it('follows the width when the rendered layout has no view for the route', () => {
    expect(heldLayout(route('send-review', ['small']), 'small', 'large', true)).toBe('small')
  })
})

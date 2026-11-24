import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

export type Layout = 'small' | 'large'
type RouteViews = Pick<RouteLocationNormalized, 'name' | 'matched'>

export interface LayoutFallback {
  to: RouteLocationRaw
  /** An info toast to show, or null. */
  notice: string | null
}

export const WIDE_SCREEN_NOTICE = 'Pillars, staking and tokens need a wider screen.'

// Where a route that only the small layout has goes on the large layout.
const LARGE_FALLBACKS: Record<string, RouteLocationRaw> = {
  'send-review': { name: 'send' },
  settings: { name: 'settings-wallets' },
  'manage-wallet': { name: 'settings-wallets' },
  'export-phrase': { name: 'settings-wallets' },
  'change-password': { name: 'settings-wallets' },
  'remove-wallet': { name: 'settings-wallets' },
}

// Where a route that only the large layout has goes on the small layout.
const SMALL_FALLBACKS: Record<string, RouteLocationRaw> = {
  activity: { name: 'home', query: { tab: 'activity' } },
}

function hasView(route: RouteViews, layout: Layout): boolean {
  return route.matched[0]?.components?.[layout] !== undefined
}

/**
 * The layout to render: the one the width asks for, unless the route only
 * has the other layout's view, while its fallback navigation is pending or
 * after a leave guard refused it.
 */
export function layoutFor(route: RouteViews, phone: boolean): Layout {
  const wanted: Layout = phone ? 'small' : 'large'
  const other: Layout = phone ? 'large' : 'small'
  return !hasView(route, wanted) && hasView(route, other) ? other : wanted
}

/**
 * The layout to render while a send holds the layout: the one rendered last,
 * when the route has a view for it. Otherwise the layout the width asks for.
 */
export function heldLayout(
  route: RouteViews,
  wanted: Layout,
  rendered: Layout | null,
  held: boolean
): Layout {
  return held && rendered !== null && hasView(route, rendered) ? rendered : wanted
}

/** Where a route with no view for `layout` goes, or null when it has one. */
export function fallbackFor(route: RouteViews, layout: Layout): LayoutFallback | null {
  if (route.matched.length === 0 || hasView(route, layout)) return null
  const name = String(route.name)
  if (layout === 'small') {
    const to = SMALL_FALLBACKS[name]
    return to ? { to, notice: null } : { to: { name: 'home' }, notice: WIDE_SCREEN_NOTICE }
  }
  return { to: LARGE_FALLBACKS[name] ?? { name: 'home' }, notice: null }
}

import type { SmallHost } from '@/apps/small/host'

export type Surface = 'popup' | 'tab' | 'window' | 'approval' | 'sidepanel'

function detectSurface(): Surface {
  if (location.pathname.endsWith('approve.html')) return 'approval'
  if (location.pathname.endsWith('sidepanel.html')) return 'sidepanel'
  const param = new URLSearchParams(location.search).get('surface')
  return param === 'tab' || param === 'window' ? param : 'popup'
}

// Read once at module load: the surface does not change for a document's lifetime.
export const surface: Surface = detectSurface()

/** popup → 'popup', tab → 'tab', sidepanel → 'side panel', window and approval → 'window'. */
export function placeLabelFor(surface: Surface): SmallHost['placeLabel'] {
  switch (surface) {
    case 'popup':
      return 'popup'
    case 'tab':
      return 'tab'
    case 'sidepanel':
      return 'side panel'
    default:
      return 'window'
  }
}

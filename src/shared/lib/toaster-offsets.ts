export interface ToasterOffsets {
  offset: { bottom: string; right: string }
  mobileOffset?: { bottom: string }
}

/** Space an in-flight transaction toast takes above the tab bar, with a gap. */
const TX_TOAST_CLEARANCE_PX = 96

/** Half the height of the centred popup frame. */
const FRAME_HALF_HEIGHT_PX = 300

export interface OffsetInputs {
  /** The surface shows the tab bar at all (false for the web large layout). */
  hostBar: boolean
  routeTabBar: boolean
  routeName: unknown
  /** An in-flight transaction toast is visible. */
  txToastShown: boolean
  framed?: boolean
}

/** Chooses the offsets from the route and surface state. */
export function offsetsFor(input: OffsetInputs): ToasterOffsets {
  const bar = input.hostBar && input.routeTabBar
  const txToast = bar && input.routeName === 'home' && input.txToastShown
  return toasterOffsets(bar, txToast, input.framed)
}

// vue-sonner uses `mobileOffset` at 600px and below and adds the bottom inset itself there.
// Above 600px it uses `offset` with no inset. Omitted sides keep its 24px default.
// `txToast` lifts the stack over the in-flight transaction toast that sits above the tab bar.
// `framed` is for the 600px frame centred in the viewport: the bottom is measured from the frame's
// bottom edge when the viewport is taller than the frame, and from the viewport's otherwise.
export function toasterOffsets(tabBar: boolean, txToast = false, framed = false): ToasterOffsets {
  const right = 'calc(24px + env(safe-area-inset-right))'
  if (tabBar) {
    const bottom = 76 + (txToast ? TX_TOAST_CLEARANCE_PX : 0)
    if (framed) {
      const value = `max(${bottom}px, calc(50vh - ${FRAME_HALF_HEIGHT_PX - bottom}px))`
      return { offset: { bottom: value, right }, mobileOffset: { bottom: value } }
    }
    return {
      offset: { bottom: `calc(${bottom}px + env(safe-area-inset-bottom))`, right },
      mobileOffset: { bottom: `${bottom}px` },
    }
  }
  return { offset: { bottom: 'calc(24px + env(safe-area-inset-bottom))', right } }
}

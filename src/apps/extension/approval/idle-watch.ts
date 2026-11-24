import { APPROVAL_WINDOW_IDLE_MS } from '@/config'

// How often the idle watch checks elapsed time against APPROVAL_WINDOW_IDLE_MS.
export const IDLE_CHECK_INTERVAL_MS = 5000
// Input that counts as the user still being here, e.g. reading and scrolling
// through a long contract call. Captured at the window, since scroll does
// not bubble out of the screen's scroll box.
export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const

export interface IdleWatch {
  /** Counts as activity now. */
  touch(): void
  /** Starts listening and checking. The idle clock restarts. */
  start(): void
  stop(): void
}

/**
 * Calls `onIdle` once APPROVAL_WINDOW_IDLE_MS passes with no input and
 * `isBusy()` false. The idle clock restarts after each call.
 */
export function createIdleWatch(options: {
  onIdle: () => void
  isBusy?: () => boolean
  target?: EventTarget
}): IdleWatch {
  const target = options.target ?? window
  let lastActivityAt = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined

  function touch(): void {
    lastActivityAt = Date.now()
  }

  // Only real user input counts: a script-dispatched event never extends the idle clock.
  function onInput(event: Event): void {
    if (event.isTrusted) touch()
  }

  function stop(): void {
    if (timer === undefined) return
    for (const name of ACTIVITY_EVENTS) target.removeEventListener(name, onInput, { capture: true })
    clearInterval(timer)
    timer = undefined
  }

  function start(): void {
    stop()
    touch()
    for (const name of ACTIVITY_EVENTS) {
      target.addEventListener(name, onInput, { capture: true, passive: true })
    }
    timer = setInterval(() => {
      if (options.isBusy?.()) return
      if (Date.now() - lastActivityAt < APPROVAL_WINDOW_IDLE_MS) return
      touch()
      options.onIdle()
    }, IDLE_CHECK_INTERVAL_MS)
  }

  return { touch, start, stop }
}

import {beginActivity} from '../send-status'

export interface ActivityController {
  /** Update the overlay to describe the current step, e.g. 'Delegating to PILLAR'. */
  setStep: (label: string) => void
}

/**
 * Run an on-chain operation behind the full-screen send overlay.
 *
 * The overlay shows the current step for as long as the operation runs, so it
 * also covers the gap between two dependent blocks. It is removed once the
 * operation settles; callers keep ownership of their own success/error toasts.
 */
export async function runActivity<T>(
  initialStep: string,
  run: (controller: ActivityController) => Promise<T>
): Promise<T> {
  const activity = beginActivity(initialStep)
  try {
    return await run({ setStep: activity.setStep })
  } finally {
    activity.end()
  }
}

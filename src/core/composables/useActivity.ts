import {watch} from 'vue'
import {toast} from 'vue-sonner'
import {isGeneratingPow} from '../pow-status'

export interface ActivityController {
  /** Update the toast to describe the current step, e.g. 'Delegating to PILLAR'. */
  setStep: (label: string) => void
}

/**
 * Run an on-chain operation behind a persistent loading toast.
 *
 * The toast shows the current step and automatically appends 'generating
 * plasma...' while Proof-of-Work runs — the slow, otherwise invisible step when
 * an account is low on plasma (e.g. changing pillar delegation). The toast is
 * dismissed once the operation settles; callers keep ownership of their own
 * success/error toasts, so this only adds the in-progress indicator.
 */
export async function runActivity<T>(
  initialStep: string,
  run: (controller: ActivityController) => Promise<T>
): Promise<T> {
  const id = toast.loading(initialStep)
  let step = initialStep

  const render = () => {
    toast.loading(isGeneratingPow.value ? `${step} — generating plasma...` : step, {id})
  }

  // Re-render the toast whenever PoW starts/stops mid-operation.
  const stopWatch = watch(isGeneratingPow, render)

  try {
    return await run({
      setStep(label) {
        step = label
        render()
      },
    })
  } finally {
    stopWatch()
    toast.dismiss(id)
  }
}

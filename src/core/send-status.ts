import {computed, ref} from 'vue'

/**
 * Global send status that drives the full-screen send overlay.
 *
 * The overlay shows while a send holds the lock (queued or running, see
 * {@link holdSendLock}) or while an activity is in progress (see
 * {@link beginActivity}), so it stays up across the gap between two
 * dependent blocks.
 */

const DEFAULT_STEP = 'Sending transaction'

const sendsInFlight = ref(0)
const activities = ref<{ id: number; step: string }[]>([])
let nextActivityId = 0

/** True while any send is queued or running, or any activity is in progress. */
export const isSendBusy = computed(() => sendsInFlight.value > 0 || activities.value.length > 0)

/** The newest activity's step, else a generic sending label. */
export const sendStep = computed(() => {
  const list = activities.value
  return list.length > 0 ? list[list.length - 1].step : DEFAULT_STEP
})

/** Keeps {@link isSendBusy} true from the call until `run` settles. */
export async function holdSendLock<T>(run: () => Promise<T>): Promise<T> {
  sendsInFlight.value++
  try {
    return await run()
  } finally {
    sendsInFlight.value--
  }
}

/** Adds a step to the overlay. `end` removes it and is safe to call twice. */
export function beginActivity(step: string): { setStep(step: string): void; end(): void } {
  const id = nextActivityId++
  activities.value = [...activities.value, { id, step }]
  return {
    setStep(next) {
      activities.value = activities.value.map((a) => (a.id === id ? { id, step: next } : a))
    },
    end() {
      activities.value = activities.value.filter((a) => a.id !== id)
    },
  }
}

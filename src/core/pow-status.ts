import {computed, ref} from 'vue'

/**
 * Global Proof-of-Work ("plasma generation") status.
 *
 * PoW runs inside `zenon.send()` only when an account lacks the plasma for a
 * block — e.g. changing pillar delegation on a fresh address sends an
 * undelegate then a delegate block, each generating PoW. That work is slow and
 * otherwise invisible; this module exposes a reactive flag so the UI can show
 * it. Tracking is wired in {@link ZenonService} by wrapping the PoW provider.
 *
 * Both PoW providers are wrapped with this: the off-thread worker (standalone
 * web app) and the sandbox-iframe provider (MV3 extension), so the flag reflects
 * PoW activity in both runtime modes.
 */

// In-flight PoW generations. A counter (not a boolean) so overlapping/sequential
// generations within one operation never clear the flag prematurely.
const activePowCount = ref(0)

/** True whenever the wallet is generating Proof-of-Work for a block. */
export const isGeneratingPow = computed(() => activePowCount.value > 0)

/**
 * Wrap a PoW provider so {@link isGeneratingPow} reflects its activity. Conforms
 * to (and returns) the SDK's `PowProvider` signature.
 */
export function trackPow<Args extends unknown[], R>(
  generate: (...args: Args) => Promise<R>
): (...args: Args) => Promise<R> {
  return async (...args: Args) => {
    activePowCount.value++
    try {
      return await generate(...args)
    } finally {
      activePowCount.value = Math.max(0, activePowCount.value - 1)
    }
  }
}

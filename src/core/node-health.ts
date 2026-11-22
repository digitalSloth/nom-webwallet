import { readonly, ref } from 'vue'
import { NODE_RETRY_MS } from '@/config'

/**
 * Whether the node answers. A failed node call marks it down; a successful
 * connection check marks it up. While it is down, a stored probe runs on a
 * timer so the flag clears once the node is back. Nothing here touches the
 * DOM or Vue lifecycles, so it runs in any document.
 */

const down = ref(false)

/** True after a failed node call, false after a successful connection check. */
export const nodeDown = readonly(down)

let probe: (() => Promise<unknown>) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

function tick(): void {
  if (inFlight || !probe) return
  inFlight = true
  void probe()
    .catch(() => {})
    .finally(() => {
      inFlight = false
    })
}

function sync(): void {
  if (down.value && probe) {
    if (timer === null) timer = setInterval(tick, NODE_RETRY_MS)
  } else if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

export function reportNodeFailure(): void {
  down.value = true
  sync()
}

export function reportNodeSuccess(): void {
  down.value = false
  sync()
}

/** While nodeDown, runs `probe` every NODE_RETRY_MS, one run at a time. Idempotent. */
export function startNodeRetry(next: () => Promise<unknown>): void {
  if (!probe) probe = next
  sync()
}

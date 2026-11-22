import type { ComputedRef } from 'vue'
import { useMediaQuery } from '@vueuse/core'

/** The phone layout query. It must match the `phone` and `desktop` variants in `src/style.css`. */
export const PHONE_QUERY = '(width < 901px)'

/** Reactive phone flag, correct on first render. */
export function usePhoneLayout(): ComputedRef<boolean> {
  return useMediaQuery(PHONE_QUERY)
}

/** One-off read for router guards. */
export function isPhoneLayout(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE_QUERY).matches
}

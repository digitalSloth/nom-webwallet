import { computed, ref, watch, onScopeDispose, type Ref } from 'vue'

const pages = ref(0)

/** True while a mounted page has a send in flight or of unknown outcome. */
export const hasUnresolvedSend = computed(() => pages.value > 0)

/**
 * Counts the calling page while `pending` is true: a send in flight or of
 * unknown outcome. The count is released when the page's scope ends, which
 * is when the user leaves it.
 */
export function trackUnresolvedSend(pending: Ref<boolean>): void {
  let counted = false
  const sync = (unresolved: boolean): void => {
    if (unresolved === counted) return
    counted = unresolved
    pages.value += unresolved ? 1 : -1
  }
  watch(pending, sync, { flush: 'sync', immediate: true })
  onScopeDispose(() => sync(false))
}

/**
 * Counts the calling page from the moment it starts submitting until its
 * outcome is resolved or it unmounts, so no tick separates the two states.
 */
export function trackSend(submitting: Ref<boolean>, unknownOutcome: Ref<boolean>): void {
  trackUnresolvedSend(computed(() => submitting.value || unknownOutcome.value))
}

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/**
 * Calls `onChange` whenever the box or one of its children changes size, and
 * returns the function that stops watching. Does nothing where the browser
 * has no ResizeObserver.
 */
export function observeBox(box: HTMLElement, onChange: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(() => onChange())
  observer.observe(box)
  for (const child of box.children) observer.observe(child)
  return () => observer.disconnect()
}

/**
 * Tracks a scrollable text box on an approval screen. `onUnread(true)` is
 * reported while the text overflows the box and the user has not scrolled to
 * the end, so the host keeps its confirm button disabled until all of the
 * text has been in view. Reports false when the screen goes away.
 */
export function useScrollGate(
  box: Readonly<Ref<HTMLElement | null>>,
  onUnread: (unread: boolean) => void
) {
  const overflows = ref(false)
  const atEnd = ref(true)

  function measure(): void {
    const el = box.value
    if (!el) return
    overflows.value = el.scrollHeight > el.clientHeight + 1
    atEnd.value = !overflows.value || el.scrollTop + el.clientHeight >= el.scrollHeight - 1
  }

  const unread = computed(() => overflows.value && !atEnd.value)
  watch(unread, (value) => onUnread(value), { immediate: true })
  let stopObserving: () => void = () => {}
  onMounted(() => {
    void nextTick(measure)
    // A box that stops overflowing opens the gate; one that starts closes it.
    if (box.value) stopObserving = observeBox(box.value, measure)
  })
  onBeforeUnmount(() => {
    stopObserving()
    onUnread(false)
  })

  return { overflows, measure }
}

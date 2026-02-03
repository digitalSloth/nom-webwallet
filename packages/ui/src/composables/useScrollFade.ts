import {computed, type CSSProperties, type MaybeRefOrGetter, onMounted, onUnmounted, ref, toValue, watch,} from 'vue'

export interface UseScrollFadeOptions {
  /** Width of the fade applied at each scrollable edge, in pixels. */
  fade?: number
  /** Scroll axis to track. Defaults to `'x'` (horizontal). */
  axis?: 'x' | 'y'
}

/**
 * Tracks the scroll position of an element and exposes a CSS mask that fades
 * whichever edge has more content to scroll towards. Pair with an
 * `overflow-x-auto` / `overflow-y-auto` container to signal that more content is
 * available. Works whether the element exists at mount or appears later (e.g.
 * behind a `v-if`).
 */
export function useScrollFade(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  options: UseScrollFadeOptions = {}
) {
  const fade = options.fade ?? 24
  const axis = options.axis ?? 'x'
  const canScrollStart = ref(false)
  const canScrollEnd = ref(false)

  const update = () => {
    const el = currentEl
    if (!el) return
    if (axis === 'x') {
      canScrollStart.value = el.scrollLeft > 1
      canScrollEnd.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    } else {
      canScrollStart.value = el.scrollTop > 1
      canScrollEnd.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    }
  }

  const maskStyle = computed<CSSProperties>(() => {
    if (!canScrollStart.value && !canScrollEnd.value) return {}
    const start = canScrollStart.value ? 'transparent' : 'black'
    const end = canScrollEnd.value ? 'transparent' : 'black'
    const direction = axis === 'x' ? 'to right' : 'to bottom'
    const mask = `linear-gradient(${direction}, ${start} 0, black ${fade}px, black calc(100% - ${fade}px), ${end} 100%)`
    return { maskImage: mask, WebkitMaskImage: mask }
  })

  let currentEl: HTMLElement | null = null
  let resizeObserver: ResizeObserver | null = null

  const detach = () => {
    currentEl?.removeEventListener('scroll', update)
    resizeObserver?.disconnect()
    resizeObserver = null
  }

  const attach = (el: HTMLElement | null) => {
    detach()
    currentEl = el
    if (!el) {
      canScrollStart.value = false
      canScrollEnd.value = false
      return
    }
    el.addEventListener('scroll', update, { passive: true })
    // Recompute on any size change — covers viewport resizes as well as content
    // growing/shrinking within the scroll container.
    resizeObserver = new ResizeObserver(update)
    resizeObserver.observe(el)
    update()
  }

  // Attach to whatever element is resolvable at mount time. This covers
  // elements that exist immediately (and refs reka swaps in non-reactively,
  // e.g. the tabs list) where a reactive watch would never fire.
  onMounted(() => attach(toValue(target) ?? null))

  // Also (re)attach when the resolved element changes reactively later — e.g.
  // a scroll container that appears after a `v-if`/`v-else` toggles.
  watch(() => toValue(target), (el) => attach(el ?? null), { flush: 'post' })

  onUnmounted(detach)

  return { canScrollStart, canScrollEnd, maskStyle, update }
}

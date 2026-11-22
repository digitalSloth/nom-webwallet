import { computed, type ComputedRef, type Ref } from 'vue'
import { isSendBusy } from '@/core'
import { hasUnresolvedSend } from '@/shared/lib/unresolved-send'
import { heldLayout, layoutFor, type Layout } from './layout-fallback'

type Route = Parameters<typeof layoutFor>[0]

/** True while a send runs or a page shows a send of unknown outcome. */
export const layoutHeld = computed(() => isSendBusy.value || hasUnresolvedSend.value)

/** The layout to render: the width's choice, except that a held layout stays. */
export function useLayout(route: Route, phone: Ref<boolean>): ComputedRef<Layout> {
  let rendered: Layout | null = null
  return computed(() => {
    const layout = heldLayout(route, layoutFor(route, phone.value), rendered, layoutHeld.value)
    rendered = layout
    return layout
  })
}

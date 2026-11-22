import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef } from 'vue'
import { useRoute } from 'vue-router'
import { useTrackedTransactions, useWallet } from '@/core'
import { toastEntry } from './tx-progress'
import { offsetsFor, type ToasterOffsets } from './toaster-offsets'

/**
 * Toaster offsets for a surface that shows the small app's tab bar on routes
 * flagged `tabBar`. Home also shows the in-flight transaction toast, so the
 * stack lifts over it while it is visible. `tabBar` lets the caller veto the
 * bar (the web large layout has none).
 */
export function useToasterOffsets(
  tabBar: () => boolean = () => true,
  framed: () => boolean = () => false
): ComputedRef<ToasterOffsets> {
  const route = useRoute()
  const wallet = useWallet()
  const { entries } = useTrackedTransactions()
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  })
  onBeforeUnmount(() => {
    if (timer !== undefined) clearInterval(timer)
  })

  return computed(() =>
    offsetsFor({
      hostBar: tabBar(),
      routeTabBar: route.meta.tabBar === true,
      routeName: route.name,
      txToastShown:
        toastEntry(entries.value, wallet.activeAccountAddress.value, now.value) !== null,
      framed: framed(),
    })
  )
}

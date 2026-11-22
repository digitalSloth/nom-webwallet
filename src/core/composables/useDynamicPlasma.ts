import { ref } from 'vue'
import type { Ref } from 'vue'
import { AccountService } from '../account-service'

/** Whether Dynamic Plasma is active; null while loading or when the node cannot say. */
export function useDynamicPlasma(): Ref<boolean | null> {
  const dynamic = ref<boolean | null>(null)

  AccountService.getInstance()
    .isDynamicPlasmaActive()
    .then((active) => {
      dynamic.value = active
    })
    .catch((error: unknown) => {
      console.warn('Could not read the Dynamic Plasma state for the approval screen', error)
    })

  return dynamic
}

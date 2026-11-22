import { ref } from 'vue'
import type { Ref } from 'vue'
import { AccountService } from '../account-service'
import type { PlasmaLevel } from '../account-service'

export type PlasmaLevelStatus = 'loading' | 'ready' | 'unavailable'

/**
 * The plasma level of one address, loaded once. A failed lookup leaves the
 * level empty and never throws, so callers show it as unavailable and carry on.
 */
export function usePlasmaLevel(address: string): {
  level: Ref<PlasmaLevel | null>
  status: Ref<PlasmaLevelStatus>
} {
  const level = ref<PlasmaLevel | null>(null)
  const status = ref<PlasmaLevelStatus>('loading')

  const service = AccountService.getInstance()
  service
    .getBasicSendQuote(address)
    .then((quote) => {
      level.value = service.getPlasmaLevel(quote.available, quote.perSend)
      status.value = 'ready'
    })
    .catch((error: unknown) => {
      console.warn('Could not load plasma for the approval screen', error)
      status.value = 'unavailable'
    })

  return { level, status }
}

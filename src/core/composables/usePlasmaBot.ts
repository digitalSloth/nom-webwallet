import { ref } from 'vue'
import {
  PlasmaBotService,
  PlasmaBotError,
  type PlasmaBotTierKey,
  type PlasmaBotFuseSuccess
} from '../plasma-bot-service'

// Module-level reactive state — shared across every usePlasmaBot() caller
const isFusing = ref(false)
const lastResult = ref<PlasmaBotFuseSuccess | null>(null)
const error = ref<PlasmaBotError | null>(null)

const service = new PlasmaBotService()

export function usePlasmaBot() {
  /**
   * Request free plasma from plasma.bot for `address` at `tier`.
   * Throws PlasmaBotError on failure (caller maps the code to a toast).
   */
  async function fuse(address: string, tier: PlasmaBotTierKey): Promise<PlasmaBotFuseSuccess> {
    isFusing.value = true
    error.value = null
    try {
      const result = await service.fuse(address, tier)
      lastResult.value = result
      return result
    } catch (err) {
      const e =
        err instanceof PlasmaBotError ? err : new PlasmaBotError('NETWORK_ERROR', 'Unexpected error')
      error.value = e
      throw e
    } finally {
      isFusing.value = false
    }
  }

  return {
    isFusing,
    lastResult,
    error,
    fuse
  }
}

import {ref} from 'vue'
import {
    PlasmaBotError,
    type PlasmaBotFuseSuccess,
    PlasmaBotService,
    type PlasmaBotStats,
    type PlasmaBotTierKey,
} from '../plasma-bot-service'

// Module-level reactive state — shared across every usePlasmaBot() caller
const isFusing = ref(false)
const lastResult = ref<PlasmaBotFuseSuccess | null>(null)
const error = ref<PlasmaBotError | null>(null)
const stats = ref<PlasmaBotStats | null>(null)
const statsStatus = ref<'idle' | 'checking' | 'online' | 'unreachable'>('idle')

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
        err instanceof PlasmaBotError
          ? err
          : new PlasmaBotError('NETWORK_ERROR', 'Unexpected error')
      error.value = e
      throw e
    } finally {
      isFusing.value = false
    }
  }

  /**
   * Fetch bot availability. Fail-open: on any error it sets `unreachable` and
   * does NOT throw, so a flaky stats endpoint never blocks a fuse.
   */
  async function loadStats(): Promise<void> {
    statsStatus.value = 'checking'
    try {
      stats.value = await service.getStats()
      statsStatus.value = 'online'
    } catch (err) {
      stats.value = null
      statsStatus.value = 'unreachable'
      console.error('Failed to load plazma.bot stats:', err)
    }
  }

  return {
    isFusing,
    lastResult,
    error,
    fuse,
    stats,
    statsStatus,
    loadStats,
  }
}

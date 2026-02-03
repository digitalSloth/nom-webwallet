import {ref} from 'vue'
import {TokenService} from '../token-service'
import type {Token} from 'znn-typescript-sdk'

// Module-level reactive state — shared across every useToken() caller
const tokenInfo = ref<Token | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useToken() {
  const tokenService = TokenService.getInstance()

  // Load token information by ZTS
  async function loadTokenInfo(tokenStandard: string) {
    if (!tokenStandard) {
      tokenInfo.value = null
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const info = await tokenService.getTokenByZts(tokenStandard)
      tokenInfo.value = info
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load token info'
      console.error('Failed to load token info:', err)
      tokenInfo.value = null
    } finally {
      isLoading.value = false
    }
  }

  return {
    // State
    tokenInfo,
    isLoading,
    error,

    // Methods
    loadTokenInfo,
  }
}

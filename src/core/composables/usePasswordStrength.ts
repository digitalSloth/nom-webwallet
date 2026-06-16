import {ref, type Ref, watch} from 'vue'
import {EMPTY_PASSWORD_STRENGTH, estimatePasswordStrength, type PasswordStrength,} from '../password-strength'

/**
 * Reactive password strength. Wraps the async (lazy-loaded zxcvbn) scorer.
 *
 * Fails closed: every password change immediately resets strength to
 * EMPTY_PASSWORD_STRENGTH (meetsFloor = false) until the new score resolves, so
 * a stale "strong" result can never gate a now-weaker password. A sequence token
 * drops out-of-order async results. This is UX state only — submit handlers MUST
 * still re-check the current password (it is the authoritative gate).
 */
export function usePasswordStrength(password: Ref<string>): Ref<PasswordStrength> {
  const strength = ref<PasswordStrength>(EMPTY_PASSWORD_STRENGTH)
  let seq = 0

  watch(
    password,
    (pw) => {
      const token = ++seq
      // Fail closed; only the resolved score for the current password re-opens it.
      strength.value = EMPTY_PASSWORD_STRENGTH
      if (!pw) return
      void estimatePasswordStrength(pw).then((result) => {
        if (token === seq) strength.value = result
      })
    },
    { immediate: true }
  )

  return strength
}

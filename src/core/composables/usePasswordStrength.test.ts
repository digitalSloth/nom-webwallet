import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref, toRaw } from 'vue'

const estimate = vi.fn()

vi.mock('../password-strength', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../password-strength')>()),
  estimatePasswordStrength: (pw: string) => estimate(pw),
}))

import { EMPTY_PASSWORD_STRENGTH } from '../password-strength'
import { usePasswordStrength } from './usePasswordStrength'

describe('usePasswordStrength', () => {
  it('holds the empty strength object, recoverable with toRaw, until the score resolves', async () => {
    estimate.mockReturnValue(new Promise(() => {}))
    const password = ref('')
    const strength = usePasswordStrength(password)

    password.value = 'a'
    await nextTick()

    expect(strength.value).not.toBe(EMPTY_PASSWORD_STRENGTH)
    expect(toRaw(strength.value)).toBe(EMPTY_PASSWORD_STRENGTH)
  })
})

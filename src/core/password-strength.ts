import {MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE, PASSWORD_STRENGTH_LABELS} from '@/config'

export interface PasswordStrength {
  bits: number
  score: 0 | 1 | 2 | 3 | 4
  label: (typeof PASSWORD_STRENGTH_LABELS)[number]
  meetsFloor: boolean
  suggestions: string[]
}

// Character-pool sizes for a rough entropy estimate (no dictionary lookup).
const POOLS: ReadonlyArray<{test: RegExp; size: number}> = [
  {test: /[a-z]/, size: 26},
  {test: /[A-Z]/, size: 26},
  {test: /[0-9]/, size: 10},
  {test: /[^a-zA-Z0-9]/, size: 32}
]

function scoreFromBits(bits: number): 0 | 1 | 2 | 3 | 4 {
  if (bits >= 100) return 4
  if (bits >= 80) return 3
  if (bits >= 60) return 2
  if (bits >= 40) return 1
  return 0
}

/**
 * Estimate password strength from length and character-class variety.
 * bits ≈ length × log2(sum of character-pool sizes present). No dictionary /
 * common-password list by design.
 */
export function estimatePasswordStrength(password: string): PasswordStrength {
  const poolSize = POOLS.reduce((sum, p) => (p.test.test(password) ? sum + p.size : sum), 0)
  const bits = password.length > 0 && poolSize > 1 ? password.length * Math.log2(poolSize) : 0
  const score = scoreFromBits(bits)
  const meetsFloor = password.length >= MIN_PASSWORD_LENGTH && score >= MIN_PASSWORD_SCORE

  const suggestions: string[] = []
  if (!meetsFloor) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      suggestions.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    const poolsUsed = POOLS.filter((p) => p.test.test(password)).length
    if (poolsUsed < 3) {
      suggestions.push('Mix in uppercase letters, numbers, or symbols')
    }
  }

  return {
    bits,
    score,
    label: PASSWORD_STRENGTH_LABELS[score],
    meetsFloor,
    suggestions
  }
}

import {MIN_PASSWORD_LENGTH, MIN_PASSWORD_SCORE, PASSWORD_STRENGTH_LABELS} from '@/config'

export interface PasswordStrength {
  bits: number
  score: 0 | 1 | 2 | 3 | 4
  label: (typeof PASSWORD_STRENGTH_LABELS)[number]
  meetsFloor: boolean
  suggestions: string[]
}

/** Neutral strength for empty input (and the initial value before scoring). */
export const EMPTY_PASSWORD_STRENGTH: PasswordStrength = {
  bits: 0,
  score: 0,
  label: PASSWORD_STRENGTH_LABELS[0],
  meetsFloor: false,
  suggestions: [],
}

// zxcvbn-ts (core + dictionaries) is dynamically imported so it lands in its own
// chunk, loaded only when a password is first scored — keeping it out of the
// initial bundle. The promise is memoized so the dictionaries load once.
type ScoreFn = (password: string) => {
  score: number
  guessesLog10: number
  feedback: { warning: string | null; suggestions: string[] }
}
let enginePromise: Promise<ScoreFn> | null = null

function loadEngine(): Promise<ScoreFn> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [core, common, en] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
        import('@zxcvbn-ts/language-en'),
      ])
      core.zxcvbnOptions.setOptions({
        dictionary: { ...common.dictionary, ...en.dictionary },
        graphs: common.adjacencyGraphs,
        translations: en.translations,
      })
      return (password: string) => core.zxcvbn(password)
    })()
  }
  return enginePromise
}

/**
 * Estimate password strength with zxcvbn — dictionary, keyboard-pattern,
 * sequence and repeat aware, so predictable passwords (common words, "qwerty…",
 * "abc…xyz") score low. Async because the scoring engine is lazy-loaded on first
 * use. Score 0–4; `meetsFloor` enforces the length + score gate.
 */
export async function estimatePasswordStrength(password: string): Promise<PasswordStrength> {
  if (!password) return EMPTY_PASSWORD_STRENGTH

  const score = await loadEngine()
  const result = score(password)
  const clamped = Math.max(0, Math.min(4, result.score)) as 0 | 1 | 2 | 3 | 4
  const bits = result.guessesLog10 * Math.log2(10)
  const meetsFloor = password.length >= MIN_PASSWORD_LENGTH && clamped >= MIN_PASSWORD_SCORE

  const suggestions: string[] = []
  if (password.length < MIN_PASSWORD_LENGTH) {
    suggestions.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (result.feedback.warning) suggestions.push(result.feedback.warning)
  suggestions.push(...result.feedback.suggestions)

  return { bits, score: clamped, label: PASSWORD_STRENGTH_LABELS[clamped], meetsFloor, suggestions }
}

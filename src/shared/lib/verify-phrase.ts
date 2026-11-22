export interface Challenge {
  // 1-based word position
  position: number
  choices: string[]
}

const CHALLENGES = 3
const DECOYS = 2

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Picks 3 positions of the phrase and, for each, the right word plus 2 decoys from the same phrase. */
export function pickChallenges(words: string[], random: () => number): Challenge[] {
  const indices = shuffle(
    words.map((_, i) => i),
    random
  )
    .slice(0, CHALLENGES)
    .sort((a, b) => a - b)

  return indices.map((index) => {
    const answer = words[index]
    const others = [...new Set(words)].filter((word) => word !== answer)
    const decoys = shuffle(others, random).slice(0, DECOYS)
    return { position: index + 1, choices: shuffle([answer, ...decoys], random) }
  })
}

/** A uniform number in [0, 1) from the browser's secure random source. */
export function cryptoRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
}

/** Whether every challenge has a pick and each pick is the word at its position. False for no challenges. */
export function allChallengesPassed(
  words: readonly string[],
  challenges: readonly Challenge[],
  picks: Readonly<Record<number, string>>
): boolean {
  return (
    challenges.length > 0 &&
    challenges.every(
      (c) => picks[c.position] !== undefined && picks[c.position] === words[c.position - 1]
    )
  )
}

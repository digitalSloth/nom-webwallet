import { describe, expect, it } from 'vitest'
import { allChallengesPassed, cryptoRandom, pickChallenges } from './verify-phrase'
import { wordlist } from '@scure/bip39/wordlists/english'

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32
    return s / 2 ** 32
  }
}

const words24 = wordlist.slice(0, 24)

describe('pickChallenges', () => {
  it.each([1, 2, 3, 42, 99, 1234])(
    'picks 3 distinct ascending positions in 1..24 (seed %s)',
    (seed) => {
      const challenges = pickChallenges(words24, seeded(seed))
      const positions = challenges.map((c) => c.position)

      expect(positions).toHaveLength(3)
      expect(new Set(positions).size).toBe(3)
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
      positions.forEach((p) => {
        expect(p).toBeGreaterThanOrEqual(1)
        expect(p).toBeLessThanOrEqual(24)
      })
    }
  )

  it('gives each challenge 3 distinct choices that include the right word', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const c of pickChallenges(words24, seeded(seed))) {
        expect(c.choices).toHaveLength(3)
        expect(new Set(c.choices).size).toBe(3)
        expect(c.choices).toContain(words24[c.position - 1])
      }
    }
  })

  it('never uses the answer word as a decoy when the phrase repeats it', () => {
    const words = [...Array(20).fill('abandon'), 'ability', 'able', 'about']
    for (let seed = 1; seed <= 30; seed++) {
      for (const c of pickChallenges(words, seeded(seed))) {
        const answer = words[c.position - 1]
        expect(c.choices.filter((w) => w === answer)).toHaveLength(1)
      }
    }
  })

  it('returns the same result for the same seeded random', () => {
    expect(pickChallenges(words24, seeded(7))).toEqual(pickChallenges(words24, seeded(7)))
  })

  it('returns without looping for a phrase of one repeated word', () => {
    const challenges = pickChallenges(Array(24).fill('abandon'), seeded(5))

    expect(challenges).toHaveLength(3)
    challenges.forEach((c) => expect(c.choices).toEqual(['abandon']))
  })
})

describe('cryptoRandom', () => {
  it('returns numbers in [0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const n = cryptoRandom()
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(1)
    }
  })
})

describe('allChallengesPassed', () => {
  const words = ['one', 'two', 'three', 'four']
  const challenges = [
    { position: 1, choices: ['one', 'two', 'four'] },
    { position: 3, choices: ['three', 'one', 'two'] },
  ]

  it('is true when every pick is the word at its position', () => {
    expect(allChallengesPassed(words, challenges, { 1: 'one', 3: 'three' })).toBe(true)
  })

  it('is false when a pick is missing', () => {
    expect(allChallengesPassed(words, challenges, { 1: 'one' })).toBe(false)
  })

  it('is false when a pick is wrong', () => {
    expect(allChallengesPassed(words, challenges, { 1: 'one', 3: 'one' })).toBe(false)
  })

  it('is false for a challenge position beyond the phrase with no pick', () => {
    expect(allChallengesPassed(words, [{ position: 9, choices: ['x'] }], {})).toBe(false)
  })

  it('is false when there are no challenges', () => {
    expect(allChallengesPassed(words, [], {})).toBe(false)
  })
})

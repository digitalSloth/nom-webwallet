import { describe, expect, it } from 'vitest'
import { heightsLabel, parseBlockHash, txSubline } from './activity'

const HASH = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'

describe('parseBlockHash', () => {
  it('returns a 64-character lower-case hex hash unchanged', () => {
    expect(parseBlockHash(HASH)).toBe(HASH)
  })

  it('lower-cases an upper-case hash', () => {
    expect(parseBlockHash(HASH.toUpperCase())).toBe(HASH)
  })

  it('trims surrounding whitespace', () => {
    expect(parseBlockHash(`  ${HASH}\n`)).toBe(HASH)
  })

  it.each([
    ['63 characters', HASH.slice(1)],
    ['65 characters', `${HASH}a`],
    ['non-hex characters', `${HASH.slice(1)}g`],
    ['an inner space', `${HASH.slice(0, 32)} ${HASH.slice(33)}`],
    ['a 0x prefix', `0x${HASH.slice(2)}`],
    ['a rejected id', 'rejected-123e4567-e89b-12d3-a456-426614174000'],
    ['an empty string', ''],
    ['only spaces', '   '],
  ])('returns null for %s', (_name, input) => {
    expect(parseBlockHash(input)).toBeNull()
  })
})

describe('heightsLabel', () => {
  it('groups thousands and joins the heights with an en dash', () => {
    expect(heightsLabel({ from: 1482, to: 1473 }, 1482)).toBe('Heights 1,482–1,473 of 1,482')
  })

  it('has no separators below 1,000', () => {
    expect(heightsLabel({ from: 2, to: 1 }, 2)).toBe('Heights 2–1 of 2')
  })
})

describe('txSubline', () => {
  const short = (a: string) => `short:${a}`

  it('names a foreign receive block by its receiver, never as the sender', () => {
    const tx = { address: 'z1receiver', meta: { kind: 'receive' } }
    expect(txSubline(tx, null, short)).toBe('Received by short:z1receiver')
  })

  it('keeps From for own accounts and foreign sends', () => {
    expect(txSubline({ address: 'z1a', meta: { kind: 'receive' } }, 'Account 1 · W', short)).toBe(
      'From Account 1 · W'
    )
    expect(txSubline({ address: 'z1a', meta: { kind: 'send' } }, null, short)).toBe(
      'From short:z1a'
    )
  })

  it('prefers the requesting origin', () => {
    expect(txSubline({ address: 'z1a', meta: { origin: 'app.io' } }, null, short)).toBe(
      'Requested by app.io'
    )
  })
})

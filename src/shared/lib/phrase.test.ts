import { describe, expect, it } from 'vitest'
import { generateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { checkPhrase, phraseStatus } from './phrase'

const VALID_12 = `${Array(11).fill('abandon').join(' ')} about`
const VALID_24 = `${Array(23).fill('abandon').join(' ')} art`

describe('checkPhrase', () => {
  it.each([
    ['24', VALID_24, 24],
    ['12', VALID_12, 12],
  ])('accepts a valid %s word phrase', (_label, text, count) => {
    const result = checkPhrase(text)

    expect(result.valid).toBe(true)
    expect(result.words).toBe(count)
    expect(result.phrase).toBe(text)
    expect(result.badWord).toBeUndefined()
  })

  it('reports an unknown word with its 1-based position', () => {
    const words = VALID_12.split(' ')
    words[4] = 'shivver'

    const result = checkPhrase(words.join(' '))

    expect(result.valid).toBe(false)
    expect(result.badWord).toEqual({ word: 'shivver', position: 5 })
  })

  it('reports the first of two unknown words', () => {
    const words = VALID_12.split(' ')
    words[2] = 'zzzz'
    words[7] = 'qqqq'

    expect(checkPhrase(words.join(' ')).badWord).toEqual({ word: 'zzzz', position: 3 })
  })

  it('rejects a phrase with a valid word list but a bad checksum, without a bad word', () => {
    const result = checkPhrase(Array(12).fill('abandon').join(' '))

    expect(result.badWord).toBeUndefined()
    expect(result.valid).toBe(false)
  })

  it.each([23, 15, 13, 11, 25])('rejects %s known words', (count) => {
    const result = checkPhrase(Array(count).fill('abandon').join(' '))

    expect(result.words).toBe(count)
    expect(result.valid).toBe(false)
  })

  it.each([15, 18, 21])('rejects a checksum-valid %s word phrase', (count) => {
    const phrase = generateMnemonic(wordlist, (count / 3) * 32)

    expect(checkPhrase(phrase)).toMatchObject({ words: count, valid: false })
  })

  it('rejects 12 words that are valid only as a different length', () => {
    expect(checkPhrase(VALID_24.split(' ').slice(0, 23).join(' ')).valid).toBe(false)
  })

  it('normalises case, tabs, newlines and repeated spaces', () => {
    const messy = `  ${VALID_12.toUpperCase()
      .replace(/ /g, '  ')
      .replace(/ about/i, '\n\tABOUT')}\n`

    const result = checkPhrase(messy)

    expect(result.phrase).toBe(VALID_12)
    expect(result.valid).toBe(true)
  })

  it('returns zero words and not valid for empty or blank text', () => {
    expect(checkPhrase('')).toMatchObject({ words: 0, phrase: '', valid: false })
    expect(checkPhrase(' \n\t ')).toMatchObject({ words: 0, valid: false })
  })
})

describe('phraseStatus', () => {
  it('says nothing for empty or blank text', () => {
    expect(phraseStatus('')).toBeNull()
    expect(phraseStatus('   ')).toBeNull()
  })

  it('reports a valid 24 word phrase', () => {
    expect(phraseStatus(VALID_24)).toEqual({ kind: 'ok', message: '24 words · valid phrase' })
  })

  it('reports a valid 12 word phrase', () => {
    expect(phraseStatus(VALID_12)).toEqual({ kind: 'ok', message: '12 words · valid phrase' })
  })

  it('asks for 12 or 24 words for a phrase of another length', () => {
    const text = Array(13).fill('abandon').join(' ')

    expect(phraseStatus(text)).toEqual({
      kind: 'info',
      message: '13 words · a phrase has 12 or 24 words',
    })
  })

  it('treats an unknown last word without trailing space as still typing', () => {
    expect(phraseStatus('abandon abandon zzzz')).toEqual({
      kind: 'info',
      message: '3 words · a phrase has 12 or 24 words',
    })
  })

  it('names an unknown last word once the text ends in whitespace', () => {
    expect(phraseStatus('abandon abandon zzzz ')).toEqual({
      kind: 'error',
      message: '"zzzz" (word 3) isn\'t a recovery phrase word.',
    })
  })

  it('names an unknown word that is not last', () => {
    expect(phraseStatus('abandon zzzz abandon')).toEqual({
      kind: 'error',
      message: '"zzzz" (word 2) isn\'t a recovery phrase word.',
    })
  })

  it('names an unknown 24th word even without trailing space', () => {
    const text = `${Array(23).fill('abandon').join(' ')} zzzz`

    expect(phraseStatus(text)?.kind).toBe('error')
    expect(phraseStatus(text)?.message).toContain('(word 24)')
  })

  it('reports a checksum failure for 24 known words', () => {
    expect(phraseStatus(Array(24).fill('abandon').join(' '))).toEqual({
      kind: 'error',
      message: "The words don't form a valid phrase. Check their order and spelling.",
    })
  })
})

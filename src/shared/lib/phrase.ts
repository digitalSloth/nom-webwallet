import { validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

const WORDS = new Set(wordlist)

export interface PhraseCheck {
  // Words lower-cased and joined by one space
  phrase: string
  words: number
  // First word that is not in the word list, 1-based
  badWord?: { word: string; position: number }
  valid: boolean
}

/** Checks pasted or typed recovery phrase text against the word list and the checksum. */
export function checkPhrase(text: string): PhraseCheck {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const phrase = words.join(' ')
  const index = words.findIndex((word) => !WORDS.has(word))
  const badWord = index === -1 ? undefined : { word: words[index], position: index + 1 }
  const valid =
    (words.length === 12 || words.length === 24) && !badWord && validateMnemonic(phrase, wordlist)
  return { phrase, words: words.length, ...(badWord && { badWord }), valid }
}

export interface PhraseStatus {
  kind: 'error' | 'info' | 'ok'
  message: string
}

/**
 * The status line under a typed recovery phrase, or null when there is
 * nothing to say. The last word is still being typed when the text does not
 * end in whitespace, unless the phrase is already 24 words long.
 */
export function phraseStatus(text: string): PhraseStatus | null {
  const c = checkPhrase(text)
  if (c.words === 0) return null
  if (c.badWord) {
    const typing = c.badWord.position === c.words && c.words !== 24 && !/\s$/.test(text)
    if (!typing) {
      return {
        kind: 'error',
        message: `"${c.badWord.word}" (word ${c.badWord.position}) isn't a recovery phrase word.`,
      }
    }
  }
  if (c.words !== 12 && c.words !== 24) {
    return { kind: 'info', message: `${c.words} words · a phrase has 12 or 24 words` }
  }
  if (c.badWord) return null
  if (!c.valid) {
    return {
      kind: 'error',
      message: "The words don't form a valid phrase. Check their order and spelling.",
    }
  }
  return { kind: 'ok', message: `${c.words} words · valid phrase` }
}

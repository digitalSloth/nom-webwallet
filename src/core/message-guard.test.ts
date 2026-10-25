import { describe, expect, it } from 'vitest'

import { messageProblem, messageSegments } from '@/core/message-guard'

describe('messageSegments', () => {
  it('returns plain text as a single visible segment', () => {
    expect(messageSegments('Sign in to example.com')).toEqual([
      { text: 'Sign in to example.com', hidden: false },
    ])
  })

  it('keeps newlines and tabs as text, since pre-wrap renders them', () => {
    expect(messageSegments('line 1\n\tline 2')).toEqual([
      { text: 'line 1\n\tline 2', hidden: false },
    ])
  })

  it('labels bidi controls so reordered text cannot pass for what is signed', () => {
    // U+202E RIGHT-TO-LEFT OVERRIDE would render "pay 100" reversed in place.
    expect(messageSegments('send \u202E001 yap')).toEqual([
      { text: 'send ', hidden: false },
      { text: 'U+202E', hidden: true },
      { text: '001 yap', hidden: false },
    ])
  })

  it('labels zero-width characters, the BOM and soft hyphens', () => {
    const parts = messageSegments('a\u200Bb\u200Dc\uFEFFd\u00ADe')
    expect(parts.filter((p) => p.hidden).map((p) => p.text)).toEqual([
      'U+200B',
      'U+200D',
      'U+FEFF',
      'U+00AD',
    ])
    expect(
      parts
        .filter((p) => !p.hidden)
        .map((p) => p.text)
        .join('')
    ).toBe('abcde')
  })

  it('labels a carriage return, so CRLF and LF messages look different', () => {
    expect(messageSegments('a\r\nb')).toEqual([
      { text: 'a', hidden: false },
      { text: 'U+000D', hidden: true },
      { text: '\nb', hidden: false },
    ])
  })

  it('labels other C0 controls and the Unicode line separators', () => {
    const hidden = messageSegments('\u0000x\u0007y\u2028z\u2029')
      .filter((p) => p.hidden)
      .map((p) => p.text)
    expect(hidden).toEqual(['U+0000', 'U+0007', 'U+2028', 'U+2029'])
  })

  it('leaves astral characters such as emoji intact', () => {
    expect(messageSegments('gm 👋')).toEqual([{ text: 'gm 👋', hidden: false }])
  })
})

describe('messageProblem', () => {
  it('accepts an ordinary message', () => {
    expect(messageProblem('hello')).toBeNull()
  })

  it('rejects an unpaired surrogate, which TextEncoder would sign as U+FFFD', () => {
    expect(messageProblem('abc\uD800def')).toMatch(/unpaired UTF-16 surrogate/)
    expect(messageProblem('abc\uDC00')).toMatch(/unpaired UTF-16 surrogate/)
  })

  it('rejects a message of exactly 32 UTF-8 bytes', () => {
    expect(messageProblem('a'.repeat(32))).toMatch(/32-byte/)
    expect(messageProblem('a'.repeat(31))).toBeNull()
  })

  it('measures the length limit in bytes, not characters', () => {
    // 'é' is two UTF-8 bytes: 4097 of them is 8194 bytes.
    expect(messageProblem('é'.repeat(4097))).toMatch(/too long/)
    expect(messageProblem('é'.repeat(4096))).toBeNull()
  })
})

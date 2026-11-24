import { describe, expect, it } from 'vitest'

import { SHEET_BACKDROP, SHEET_CARD, SHEET_DIALOG, SHEET_FOOTER } from './sheet'

const tokens = (value: string): string[] => value.split(/\s+/).filter(Boolean)

describe('sheet classes', () => {
  it.each([
    ['SHEET_DIALOG', SHEET_DIALOG],
    ['SHEET_FOOTER', SHEET_FOOTER],
    ['SHEET_BACKDROP', SHEET_BACKDROP],
    ['SHEET_CARD', SHEET_CARD],
  ])('%s tokens each carry one phone: or desktop: variant', (_name, value) => {
    for (const token of tokens(value)) {
      expect(token.startsWith('phone:') || token.startsWith('desktop:')).toBe(true)
      expect(token.slice(1)).not.toMatch(/phone:|desktop:/)
    }
  })

  it('SHEET_DIALOG pins to the bottom on phones and keeps the desktop width', () => {
    expect(tokens(SHEET_DIALOG)).toEqual(
      expect.arrayContaining([
        'phone:top-auto',
        'phone:bottom-0',
        'phone:translate-y-0',
        'phone:max-w-none',
        'phone:max-h-[92dvh]',
        'phone:rounded-b-none',
        'phone:pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
        'desktop:max-w-[480px]',
      ])
    )
  })

  it('SHEET_CARD caps height and scrolls on phones', () => {
    expect(tokens(SHEET_CARD)).toEqual(
      expect.arrayContaining([
        'phone:max-h-[92dvh]',
        'phone:overflow-y-auto',
        'phone:rounded-b-none',
        'phone:pb-[calc(1.5rem+env(safe-area-inset-bottom))]',
      ])
    )
  })

  it('SHEET_BACKDROP and SHEET_FOOTER carry their layout tokens', () => {
    expect(tokens(SHEET_BACKDROP)).toEqual(['phone:items-end', 'phone:p-0'])
    expect(tokens(SHEET_FOOTER)).toEqual(
      expect.arrayContaining(['phone:flex-row', 'phone:*:flex-1'])
    )
  })
})

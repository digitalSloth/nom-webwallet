import { describe, expect, it } from 'vitest'
import { ZNN_ZTS } from 'znn-typescript-sdk'
import { TOKEN_ISSUE_FEE } from '@/config'
import { formatAmount } from '@/shared/lib/amount'
import { NAME_PATTERN, issueMeta, parseIssueForm, permanentNote, znnBalanceOf } from './token-issue'
import type { IssueForm } from './token-issue'

const MAX_RAW = 2n ** 255n - 1n

const baseForm = (over: Partial<IssueForm> = {}): IssueForm => ({
  name: 'MyToken',
  symbol: 'MYT',
  domain: '',
  decimals: '8',
  totalSupply: '1000',
  maxSupply: '2000',
  mintable: true,
  burnable: true,
  utility: false,
  ...over,
})

const check = (over: Partial<IssueForm> = {}, balance: bigint | null = TOKEN_ISSUE_FEE) =>
  parseIssueForm(baseForm(over), balance)

const ok = (over: Partial<IssueForm> = {}) => {
  const c = check(over)
  expect(c.errors).toEqual({})
  expect(c.params).not.toBeNull()
  return c
}

describe('base form', () => {
  it('passes and converts whole tokens to base units', () => {
    expect(ok().params).toEqual({
      name: 'MyToken',
      symbol: 'MYT',
      domain: '',
      totalSupply: 100_000_000_000n,
      maxSupply: 200_000_000_000n,
      decimals: 8,
      mintable: true,
      burnable: true,
      utility: false,
    })
  })

  it('returns no params while any required field is empty', () => {
    for (const field of ['name', 'symbol', 'decimals', 'totalSupply', 'maxSupply'] as const) {
      const c = check({ [field]: '' })
      expect(c.params, field).toBeNull()
      expect(c.errors, field).toEqual({})
    }
  })

  it('does not need a max supply when the token is not mintable', () => {
    const c = ok({ mintable: false, maxSupply: '' })
    expect(c.params?.maxSupply).toBe(c.params?.totalSupply)
  })
})

describe('name', () => {
  it('accepts 40 characters and refuses 41', () => {
    expect(ok({ name: 'a'.repeat(40) }).params?.name).toBe('a'.repeat(40))
    expect(check({ name: 'a'.repeat(41) }).errors.name).toBeDefined()
    expect(check({ name: 'a'.repeat(41) }).params).toBeNull()
  })

  it('accepts single separators between letters and digits', () => {
    ok({ name: 'a.b-c_d' })
    ok({ name: 'A1' })
    ok({ name: 'a' })
  })

  it.each([
    ['a space inside', 'My Token'],
    ['two separators in a row', 'a..b'],
    ['a leading separator', '-a'],
    ['a trailing separator', 'a-'],
    ['a non-ASCII letter', 'é'],
    ['a newline inside', 'a\nb'],
    ['a plus sign', 'a+b'],
    ['only a separator', '_'],
  ])('refuses %s', (_label, name) => {
    const c = check({ name })
    expect(c.errors.name).toBeDefined()
    expect(c.params).toBeNull()
  })

  it('trims surrounding spaces into params.name', () => {
    expect(ok({ name: '  MyToken  ' }).params?.name).toBe('MyToken')
  })

  it('leaves a 40-character name with surrounding spaces valid', () => {
    expect(ok({ name: ` ${'a'.repeat(40)} ` }).params?.name).toHaveLength(40)
  })
})

describe('name pattern equivalence with the node pattern', () => {
  // go-zenon: ^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$ (nested, backtracking)
  const NODE_PATTERN = /^([a-zA-Z0-9]+[-._]?)*[a-zA-Z0-9]$/
  const ALPHABET = ['a', 'Z', '0', '-', '.', '_', ' ']

  it('agrees on every string of length 1 to 5 over the alphabet', () => {
    const started = performance.now()
    let count = 0
    const walk = (prefix: string, left: number) => {
      if (prefix !== '') {
        count++
        const expected = NODE_PATTERN.test(prefix)
        if (NAME_PATTERN.test(prefix) !== expected) {
          throw new Error(`patterns disagree on ${JSON.stringify(prefix)}`)
        }
      }
      if (left === 0) return
      for (const ch of ALPHABET) walk(prefix + ch, left - 1)
    }
    walk('', 5)

    expect(count).toBe(19_607)
    expect(performance.now() - started).toBeLessThan(5_000)
  })

  it('returns within 50 ms for 39 letters followed by an invalid character', () => {
    const started = performance.now()
    const c = check({ name: `${'a'.repeat(39)}!` })
    expect(performance.now() - started).toBeLessThan(50)
    expect(c.errors.name).toBeDefined()
  })

  it('returns within 50 ms for a long separator-heavy name', () => {
    const started = performance.now()
    const c = check({ name: `${'a-'.repeat(19)}a!` })
    expect(performance.now() - started).toBeLessThan(50)
    expect(c.errors.name).toBeDefined()
  })
})

describe('symbol', () => {
  it('accepts 10 characters and refuses 11', () => {
    expect(ok({ symbol: 'A'.repeat(10) }).params?.symbol).toBe('A'.repeat(10))
    expect(check({ symbol: 'A'.repeat(11) }).errors.symbol).toBeDefined()
  })

  it('upper-cases a lower-case symbol', () => {
    expect(ok({ symbol: 'myt' }).params?.symbol).toBe('MYT')
  })

  it('accepts digits', () => {
    ok({ symbol: 'A1' })
  })

  it.each(['ZNN', 'QSR', 'znn', 'qsr', ' Znn '])('refuses the reserved symbol %s', (symbol) => {
    const c = check({ symbol })
    expect(c.errors.symbol).toBe('ZNN and QSR are reserved')
    expect(c.params).toBeNull()
  })

  it.each(['ZNNN', 'QSRX', 'ZN'])('accepts %s, which is not reserved', (symbol) => {
    ok({ symbol })
  })

  it.each(['MY-T', 'MY T', 'M.T', 'M_T', 'É'])('refuses %s', (symbol) => {
    expect(check({ symbol }).errors.symbol).toBeDefined()
  })

  it('applies the length limit after upper-casing and trimming', () => {
    expect(ok({ symbol: ` ${'a'.repeat(10)} ` }).params?.symbol).toBe('A'.repeat(10))
  })
})

describe('domain', () => {
  const label63 = 'a'.repeat(63)

  it('accepts an empty domain and sends the empty string', () => {
    expect(ok({ domain: '' }).params?.domain).toBe('')
    expect(ok({ domain: '   ' }).params?.domain).toBe('')
  })

  it.each(['example.com', 'a-b.example.co', 'ab.io', 'a1.b2.example.org', 'ab.CO'])(
    'accepts %s',
    (domain) => {
      expect(ok({ domain }).params?.domain).toBe(domain)
    }
  )

  it('accepts a 128-character domain and refuses 129', () => {
    const d128 = `${label63}.${'a'.repeat(60)}.com`
    expect(d128).toHaveLength(128)
    ok({ domain: d128 })
    const d129 = `${label63}.${'a'.repeat(61)}.com`
    expect(d129).toHaveLength(129)
    expect(check({ domain: d129 }).errors.domain).toBeDefined()
  })

  it('accepts a 63-character label and refuses 64', () => {
    ok({ domain: `${label63}.com` })
    expect(check({ domain: `${label63}a.com` }).errors.domain).toBeDefined()
  })

  it.each([
    ['no top-level domain', 'example'],
    ['a leading hyphen', '-a.com'],
    ['a trailing hyphen in a label', 'a-.com'],
    ['a one-letter top-level domain', 'a.c'],
    ['a one-letter top-level domain on valid labels', 'ab.c'],
    ['an underscore', 'exa_mple.com'],
    ['a one-character label, as the node requires two', 'x.com'],
    ['a one-character label deeper in', 'ab.x.com'],
    ['a digit in the top-level domain', 'example.c0m'],
    ['a trailing dot', 'example.com.'],
    ['a scheme', 'https://example.com'],
    ['a path', 'example.com/a'],
    ['a space', 'exa mple.com'],
  ])('refuses %s', (_label, domain) => {
    const c = check({ domain })
    expect(c.errors.domain).toBeDefined()
    expect(c.params).toBeNull()
  })
})

describe('decimals', () => {
  it.each(['0', '18', '8', '00', '09'])('accepts %s', (decimals) => {
    expect(ok({ decimals, totalSupply: '1', maxSupply: '1' }).params?.decimals).toBe(
      Number(decimals)
    )
  })

  it.each(['19', '99', '8.5', '-1', '1e1', '019', 'a', '+1', '100'])('refuses %s', (decimals) => {
    const c = check({ decimals })
    expect(c.errors.decimals).toBeDefined()
    expect(c.params).toBeNull()
  })
})

describe('supplies', () => {
  it('converts 1000000 at 8 decimals exactly', () => {
    const c = ok({ totalSupply: '1000000', maxSupply: '1000000' })
    expect(c.params?.totalSupply).toBe(100_000_000_000_000n)
  })

  it('refuses a fraction beyond the decimals', () => {
    expect(check({ decimals: '0', totalSupply: '1.5' }).errors.totalSupply).toBeDefined()
    expect(check({ decimals: '8', totalSupply: '1.123456789' }).errors.totalSupply).toBeDefined()
    expect(check({ decimals: '0', maxSupply: '1.5' }).errors.maxSupply).toBeDefined()
  })

  it('converts one base unit at 18 decimals', () => {
    const c = ok({ decimals: '18', totalSupply: '0.000000000000000001', maxSupply: '1' })
    expect(c.params?.totalSupply).toBe(1n)
    expect(c.params?.maxSupply).toBe(10n ** 18n)
  })

  it('does not lose precision above 2^53', () => {
    const c = ok({ decimals: '0', totalSupply: '9007199254740993', maxSupply: '9007199254740993' })
    expect(c.params?.totalSupply).toBe(9_007_199_254_740_993n)
  })

  it('accepts total 0 with a positive max when mintable', () => {
    const c = ok({ totalSupply: '0', maxSupply: '5' })
    expect(c.params?.totalSupply).toBe(0n)
    expect(c.params?.maxSupply).toBe(500_000_000n)
  })

  it('sets max to total for a fixed supply, whatever maxSupply holds', () => {
    for (const maxSupply of ['', '5', 'junk', '9999999']) {
      const c = ok({ mintable: false, totalSupply: '1000', maxSupply })
      expect(c.params?.maxSupply).toBe(100_000_000_000n)
      expect(c.params?.totalSupply).toBe(100_000_000_000n)
    }
  })

  it('accepts max equal to total and refuses max below total', () => {
    ok({ totalSupply: '10', maxSupply: '10' })
    const c = check({ totalSupply: '10', maxSupply: '9.99999999' })
    expect(c.errors.maxSupply).toBe('Max supply must be at least the initial supply')
    expect(c.params).toBeNull()
  })

  it('refuses max 0 on maxSupply when mintable', () => {
    const c = check({ totalSupply: '0', maxSupply: '0' })
    expect(c.errors.maxSupply).toBe('Max supply must be above 0')
    expect(c.params).toBeNull()
  })

  it('refuses a fixed supply of 0 on totalSupply', () => {
    const c = check({ mintable: false, totalSupply: '0' })
    expect(c.errors.totalSupply).toBe('Initial supply must be above 0')
    expect(c.errors.maxSupply).toBeUndefined()
    expect(c.params).toBeNull()
  })

  it('refuses a malformed total or max', () => {
    for (const bad of ['abc', '-1', '1,5', '1e3', '.5', '1.']) {
      expect(check({ totalSupply: bad }).errors.totalSupply, bad).toBeDefined()
      expect(check({ maxSupply: bad }).errors.maxSupply, bad).toBeDefined()
    }
  })

  it('accepts a max of 2^255-1 raw and refuses 2^255 (decimals 0)', () => {
    const max = check({ decimals: '0', totalSupply: '1', maxSupply: MAX_RAW.toString() })
    expect(max.errors).toEqual({})
    expect(max.params?.maxSupply).toBe(MAX_RAW)

    const over = check({ decimals: '0', totalSupply: '1', maxSupply: (MAX_RAW + 1n).toString() })
    expect(over.errors.maxSupply).toBe('This supply is too large')
    expect(over.params).toBeNull()
  })

  it('applies the same limit to a fixed supply', () => {
    ok({ decimals: '0', mintable: false, totalSupply: MAX_RAW.toString() })
    const over = check({ decimals: '0', mintable: false, totalSupply: (MAX_RAW + 1n).toString() })
    expect(over.errors.totalSupply).toBe('This supply is too large')
  })

  it('converts the maximum supply exactly at 18 decimals and refuses one unit more', () => {
    const text = (raw: bigint) => formatAmount(raw, 18)
    const at = check({ decimals: '18', totalSupply: text(MAX_RAW), maxSupply: text(MAX_RAW) })
    expect(at.errors).toEqual({})
    expect(at.params?.totalSupply).toBe(MAX_RAW)
    expect(at.params?.maxSupply).toBe(MAX_RAW)

    const over = check({
      decimals: '18',
      totalSupply: '1',
      maxSupply: text(MAX_RAW + 1n),
    })
    expect(over.errors.maxSupply).toBe('This supply is too large')
  })

  it('refuses a total above the limit even with a max at the limit', () => {
    const c = check({
      decimals: '0',
      totalSupply: (MAX_RAW + 1n).toString(),
      maxSupply: MAX_RAW.toString(),
    })
    expect(c.params).toBeNull()
    expect(c.errors.maxSupply).toBeDefined()
  })
})

describe('fee', () => {
  it('refuses 99_999_999n with the fee message', () => {
    const c = parseIssueForm(baseForm(), 99_999_999n)
    expect(c.errors.fee).toBe('Issuing needs 1 ZNN')
    expect(c.params).toBeNull()
  })

  it('accepts exactly 100_000_000n', () => {
    expect(parseIssueForm(baseForm(), 100_000_000n).params).not.toBeNull()
    expect(parseIssueForm(baseForm(), 100_000_001n).errors).toEqual({})
  })

  it('refuses a zero balance', () => {
    expect(parseIssueForm(baseForm(), 0n).errors.fee).toBeDefined()
  })

  it('returns null params and no fee error while the balance is unknown', () => {
    const c = parseIssueForm(baseForm(), null)
    expect(c.params).toBeNull()
    expect(c.errors.fee).toBeUndefined()
  })

  it('refuses a low balance even when the rest of the form is empty', () => {
    expect(parseIssueForm(baseForm({ name: '' }), 5n).errors.fee).toBeDefined()
  })

  it('is exactly one ZNN as a bigint', () => {
    expect(TOKEN_ISSUE_FEE).toBe(100_000_000n)
  })
})

describe('errors', () => {
  it('reports a bad name, symbol and decimals at once', () => {
    const c = check({ name: '-bad', symbol: 'ZNN', decimals: '19' })
    expect(Object.keys(c.errors).sort()).toEqual(['decimals', 'name', 'symbol'])
    expect(c.params).toBeNull()
  })

  it('reports only the first supply rule on one field', () => {
    const c = check({ totalSupply: '5', maxSupply: '0' })
    expect(c.errors.maxSupply).toBe('Max supply must be above 0')
  })
})

describe('issueMeta', () => {
  it('returns the fee and the symbol the page shows', () => {
    const params = ok().params
    expect(params).not.toBeNull()
    expect(issueMeta(params as never)).toEqual({
      kind: 'contract',
      title: 'Token · Issue MYT',
      progress: 'Issuing MYT',
      amount: '100000000',
      decimals: 8,
      symbol: 'ZNN',
      tokenStandard: ZNN_ZTS.toString(),
    })
  })
})

describe('permanentNote', () => {
  it('names the fixed supply only when the token is not mintable', () => {
    expect(permanentNote(true)).toBe(
      'Name, symbol, decimals, domain and the utility flag are permanent. You can turn minting off later, but never back on.'
    )
    expect(permanentNote(false)).toBe(
      'Name, symbol, decimals, domain, the utility flag and the fixed supply are permanent. No one can ever mint more of this token.'
    )
  })
})

describe('znnBalanceOf', () => {
  const znn = { tokenStandard: ZNN_ZTS.toString(), balance: '250000000', decimals: 8 }

  it('is null while loading with no balances', () => {
    expect(znnBalanceOf([], true)).toBeNull()
  })

  it('is 0n for a loaded account with no balances', () => {
    expect(znnBalanceOf([], false)).toBe(0n)
  })

  it('finds the ZNN entry by token standard', () => {
    const other = { tokenStandard: 'zts1other', balance: '7', decimals: 8, symbol: 'OTH' }
    expect(znnBalanceOf([other, znn], false)).toBe(250_000_000n)
    expect(znnBalanceOf([other, znn], true)).toBe(250_000_000n)
  })

  it('is 0n when only a token with symbol ZNN but another standard is held', () => {
    const fake = { tokenStandard: 'zts1fake', balance: '900000000', decimals: 8, symbol: 'ZNN' }
    expect(znnBalanceOf([fake], false)).toBe(0n)
  })
})

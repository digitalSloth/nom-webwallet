import { describe, expect, it } from 'vitest'
import type { SessionTypes } from '@walletconnect/types'
import type { WalletAccount } from '@/types'
import { shortAddress } from '@/shared/lib/format'
import { sessionDetail, sessionRows } from './connected-apps'

const ADDRESS = 'z1qzlzvtzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'

function session(
  topic: string,
  metadata: Record<string, unknown> = { name: 'Dapp', url: 'https://dapp.example/path' },
  accounts: string[] | null = [`zenon:1:${ADDRESS}`]
): SessionTypes.Struct {
  return {
    topic,
    peer: { metadata },
    namespaces: accounts !== null ? { zenon: { accounts } } : {},
  } as unknown as SessionTypes.Struct
}

const wallets = [
  {
    accounts: [
      { address: ADDRESS, index: 0, label: 'Main' },
      { address: 'z1other', index: 1, label: '' },
    ] as WalletAccount[],
  },
  { accounts: [{ address: 'z1second', index: 2, label: 'Second' }] as WalletAccount[] },
]

const row = (s: SessionTypes.Struct, meta = {}) => sessionRows([s], meta, wallets)[0]

describe('sessionRows', () => {
  it.each([
    ['empty', { name: '' }],
    ['whitespace', { name: '   ' }],
    ['missing', {}],
    ['non-string', { name: 42 }],
  ])('names a peer with a %s name Unknown dApp', (_label, metadata) => {
    expect(row(session('t', metadata))).toMatchObject({ name: 'Unknown dApp', initial: 'U' })
  })

  it('trims the name and upper-cases its first code point', () => {
    expect(row(session('t', { name: '  zApp ' }))).toMatchObject({ name: 'zApp', initial: 'Z' })
    expect(row(session('t', { name: '😀 fun' })).initial).toBe('😀')
  })

  it('takes the host from the url and shows raw text for a non-URL', () => {
    expect(row(session('t', { name: 'a', url: 'https://dapp.example/x' })).host).toBe(
      'dapp.example'
    )
    expect(row(session('t', { name: 'a', url: '<b>x</b>' })).host).toBe('<b>x</b>')
  })

  it('gives an empty host for a non-string url', () => {
    expect(row(session('t', { name: 'a', url: 5 })).host).toBe('')
    expect(row(session('t', { name: 'a' })).host).toBe('')
  })

  it('never exposes the peer icons', () => {
    const r = row(session('t', { name: 'a', icons: ['https://evil.example/i.png'] }))

    expect(JSON.stringify(r)).not.toContain('evil.example')
  })

  it('labels the account from its label, its index, a second wallet, or a short address', () => {
    expect(row(session('t', undefined, [`zenon:1:${ADDRESS}`])).accountLabel).toBe('Main')
    expect(row(session('t', undefined, ['zenon:1:z1other'])).accountLabel).toBe('Account 2')
    expect(row(session('t', undefined, ['zenon:1:z1second'])).accountLabel).toBe('Second')
    expect(row(session('t', undefined, ['zenon:1:z1unknownaddressxyz'])).accountLabel).toBe(
      shortAddress('z1unknownaddressxyz')
    )
  })

  it('gives null when the session has no namespace accounts', () => {
    expect(row(session('t', undefined, null)).accountLabel).toBeNull()
    expect(row(session('t', undefined, [])).accountLabel).toBeNull()
  })

  it.each([
    ['valid', 'Verified', 'success'],
    ['unknown', 'Unverified', 'warning'],
    ['invalid', 'Unverified', 'destructive'],
  ] as const)('maps %s meta to the %s badge with a date', (verification, text, tone) => {
    const approvedAt = new Date(2026, 2, 5).getTime()

    const r = row(session('t'), { t: { verification, approvedAt } })

    expect(r.verification).toEqual({ text, tone })
    expect(r.connectedOn).toBe(
      new Date(approvedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    )
  })

  it('gives no badge and no date without meta for the topic', () => {
    const r = row(session('t'), { other: { verification: 'valid', approvedAt: 1 } })

    expect(r.verification).toBeNull()
    expect(r.connectedOn).toBeNull()
  })

  it('keeps the session order', () => {
    const rows = sessionRows([session('b'), session('a'), session('c')], {}, wallets)

    expect(rows.map((r) => r.topic)).toEqual(['b', 'a', 'c'])
  })
})

describe('sessionDetail', () => {
  const base = { host: '', accountLabel: null, connectedOn: null }

  it('joins only the parts that are present', () => {
    expect(sessionDetail({ ...base, accountLabel: 'Main', connectedOn: '3 Nov' } as never)).toBe(
      'Main · connected 3 Nov'
    )
    expect(sessionDetail({ ...base, host: 'a.example', connectedOn: '3 Nov' } as never)).toBe(
      'a.example · connected 3 Nov'
    )
    expect(sessionDetail({ ...base, host: 'a.example', accountLabel: 'Main' } as never)).toBe(
      'a.example · Main'
    )
    expect(sessionDetail(base as never)).toBe('')
  })
})

import { describe, expect, it } from 'vitest'

import type { BlockStatus } from '@/core'
import {
  accountCountLabel,
  blockStatusLabel,
  blockStatusTone,
  explorerAccountUrl,
  explorerBlockUrl,
  explorerMomentumUrl,
  networkLabel,
  relativeTime,
  shortAddress,
  urlHost,
} from './format'

describe('networkLabel', () => {
  it('names chain 1 Mainnet and other chains by id', () => {
    expect(networkLabel(1)).toBe('Mainnet')
    expect(networkLabel(3)).toBe('Chain 3')
  })
})

describe('shortAddress', () => {
  it('abbreviates a full address to its first 6 and last 5 characters', () => {
    const address = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'
    expect(shortAddress(address)).toBe('z1qzal…6a0mz')
  })

  it('leaves a short string unchanged', () => {
    expect(shortAddress('z1qshort')).toBe('z1qshort')
  })
})

describe('relativeTime', () => {
  const now = 1_700_000_000_000
  const ago = (ms: number) => relativeTime(now - ms, now)

  it('rounds down to the largest unit', () => {
    expect(ago(59_000)).toBe('just now')
    expect(ago(60_000)).toBe('1 min ago')
    expect(ago(59 * 60_000)).toBe('59 min ago')
    expect(ago(3_600_000)).toBe('1 h ago')
    expect(ago(23 * 3_600_000)).toBe('23 h ago')
    expect(ago(86_400_000)).toBe('1 day ago')
    expect(ago(3 * 86_400_000)).toBe('3 days ago')
  })

  it('treats a future time as just now', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now')
  })
})

describe('urlHost', () => {
  it('returns the hostname without scheme, port or path', () => {
    expect(urlHost('wss://node.zenonhub.io:35998')).toBe('node.zenonhub.io')
    expect(urlHost('https://dapp.example/path')).toBe('dapp.example')
  })

  it('returns the input unchanged when it is not a URL', () => {
    expect(urlHost('not a url')).toBe('not a url')
  })
})

describe('block status labels and tones', () => {
  const cases: [BlockStatus, string, string][] = [
    ['unconfirmed', 'Unconfirmed', 'pending'],
    ['confirmed', 'Confirmed', 'success'],
    ['executed', 'Executed', 'success'],
    ['failed', 'Failed', 'failed'],
    ['notReceived', 'Not received yet', 'confirming'],
    ['received', 'Received', 'success'],
  ]

  it.each(cases)('%s reads %s with tone %s', (status, label, tone) => {
    expect(blockStatusLabel(status)).toBe(label)
    expect(blockStatusTone(status)).toBe(tone)
  })
})

describe('explorer urls', () => {
  it('points at the block, account and momentum pages', () => {
    expect(explorerBlockUrl('abc')).toBe('https://zenonhub.io/explorer/block/abc')
    expect(explorerAccountUrl('z1addr')).toBe('https://zenonhub.io/explorer/account/z1addr')
    expect(explorerMomentumUrl('def')).toBe('https://zenonhub.io/explorer/momentum/def')
  })

  it('keeps the fixed base whatever the argument holds', () => {
    expect(explorerBlockUrl('//evil.test/x')).toMatch(/^https:\/\/zenonhub\.io\/explorer\/block\//)
    expect(explorerAccountUrl('https://evil.test')).toBe(
      'https://zenonhub.io/explorer/account/https://evil.test'
    )
  })
})

describe('accountCountLabel', () => {
  it('uses the singular for one account', () => {
    expect(accountCountLabel([{}])).toBe('1 account')
  })

  it('counts several accounts', () => {
    expect(accountCountLabel([{}, {}, {}, {}])).toBe('4 accounts')
  })

  it('adds the hidden count', () => {
    expect(accountCountLabel([{}, {}, {}, { hidden: true }])).toBe('4 accounts · 1 hidden')
  })

  it('treats hidden false as visible', () => {
    expect(accountCountLabel([{ hidden: false }, { hidden: false }])).toBe('2 accounts')
  })
})

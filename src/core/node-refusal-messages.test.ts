import { describe, expect, it } from 'vitest'

import { isKnownRefusalMessage } from './node-refusal-messages'
import { isNodeRejection } from './transaction-service'

const ADDED = [
  'invalid token name/symbol/domain/decimals',
  'invalid token total/max supply',
  'invalid token or amount',
  'invalid unpack method data',
  'invalid hash type',
  'invalid hash digest',
]

describe('token and HTLC refusal texts', () => {
  it.each(ADDED)('%s is a known refusal, bare and with a detail suffix', (text) => {
    expect(isKnownRefusalMessage(text)).toBe(true)
    expect(isKnownRefusalMessage(`${text} - detail`)).toBe(true)
  })

  it.each(ADDED)('%s is a node rejection at code -32000', (text) => {
    expect(isNodeRejection({ code: -32000, message: text })).toBe(true)
  })

  it('does not accept a near-miss text', () => {
    expect(isKnownRefusalMessage('invalid hash')).toBe(false)
    expect(isNodeRejection({ code: -32000, message: 'invalid hash type extra' })).toBe(false)
  })
})

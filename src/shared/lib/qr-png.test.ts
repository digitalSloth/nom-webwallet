import { describe, expect, it } from 'vitest'

import { qrFileName } from './qr-png'

describe('qrFileName', () => {
  it('names the file after the first 8 characters of the address', () => {
    expect(qrFileName('z1qabcdefghijk')).toBe('nom-z1qabcde.png')
  })
})

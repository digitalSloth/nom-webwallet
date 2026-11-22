import { describe, expect, it } from 'vitest'
import { addNumberDecimals, QSR_ZTS, ZNN_ZTS, Zenon } from 'znn-typescript-sdk'

import {
  approvalDataHex,
  approvalPeerIcon,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  coreTokenSymbol,
  dataTextView,
  decodedCallView,
  formatApprovalAmount,
} from '@/core/approval-display'
import type { ApprovalAction, PendingApproval } from '@/core/dapp-approvals'

const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()
const OTHER = 'zts1abcdefghjklmnpqrstuvwxy'
const PILLAR = 'z1qxemdeddedxpyllarxxxxxxxxxxxxxxxsy3fmg'

function approval(
  surface: PendingApproval['surface'],
  action: ApprovalAction,
  icons: string[]
): PendingApproval {
  return {
    id: 'x:1',
    surface,
    origin: 'https://dapp.example',
    peer: { name: 'dApp', url: 'https://dapp.example', icons },
    createdAt: 0,
    account: 'z1account',
    chainId: 1,
    action,
  }
}

const CONNECT: ApprovalAction = { kind: 'connect' } as ApprovalAction
const SIGN: ApprovalAction = { kind: 'signMessage', message: 'hi' }

describe('coreTokenSymbol', () => {
  it('names ZNN and QSR and nothing else', () => {
    expect(coreTokenSymbol(ZNN)).toBe('ZNN')
    expect(coreTokenSymbol(QSR)).toBe('QSR')
    expect(coreTokenSymbol(OTHER)).toBeNull()
  })
})

describe('formatApprovalAmount', () => {
  it('formats ZNN and QSR with 8 decimals and the symbol', () => {
    expect(formatApprovalAmount(100000000n, ZNN)).toBe(`${addNumberDecimals(100000000n, 8)} ZNN`)
    expect(formatApprovalAmount(100000000n, QSR)).toBe(`${addNumberDecimals(100000000n, 8)} QSR`)
    expect(formatApprovalAmount('150000000', ZNN)).toBe('1.5 ZNN')
  })

  it('shows raw units with the token standard for any other token', () => {
    expect(formatApprovalAmount(100000000n, OTHER)).toBe(`100000000 raw units (${OTHER})`)
  })
})

describe('approvalPeerIcon', () => {
  const https = 'https://dapp.example/icon.png'

  it('gives a WalletConnect connect request no icon', () => {
    expect(approvalPeerIcon(approval('walletconnect', CONNECT, [https]))).toBeNull()
  })

  it('gives a WalletConnect sign request an https icon', () => {
    expect(approvalPeerIcon(approval('walletconnect', SIGN, [https]))).toBe(https)
  })

  it('rejects non-https icons', () => {
    expect(
      approvalPeerIcon(approval('walletconnect', SIGN, ['http://dapp.example/i.png']))
    ).toBeNull()
    expect(approvalPeerIcon(approval('inpage', SIGN, ['data:image/png;base64,AA']))).toBeNull()
  })

  it('gives null when there are no icons', () => {
    expect(approvalPeerIcon(approval('walletconnect', SIGN, []))).toBeNull()
  })

  it('gives an in-page request its https icon, including on connect', () => {
    expect(approvalPeerIcon(approval('inpage', SIGN, [https]))).toBe(https)
    expect(approvalPeerIcon(approval('inpage', CONNECT, [https]))).toBe(https)
  })

  it('uses only the first icon', () => {
    expect(approvalPeerIcon(approval('inpage', SIGN, ['http://a/i.png', https]))).toBeNull()
  })
})

describe('decodedCallView', () => {
  it('returns null for a recipient that is not an embedded contract', () => {
    const block = Zenon.getInstance().embedded.pillar.delegate('Anvil')
    expect(decodedCallView('z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz', block.data)).toBeNull()
  })

  it('returns null when the data does not decode', () => {
    expect(decodedCallView(PILLAR, new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('decodes the call and marks hidden characters in the arguments', () => {
    const block = Zenon.getInstance().embedded.pillar.delegate('An‮vil')

    const view = decodedCallView(block.toAddress.toString(), block.data)

    expect(view).toMatchObject({ contract: 'Pillar', method: 'Delegate' })
    expect(view?.args).toHaveLength(1)
    expect(view?.args[0].name).toBe('name')
    const parts = view!.args[0].parts
    expect(parts.some((p) => JSON.stringify(p).includes('202E'))).toBe(true)
    expect(JSON.stringify(parts)).toMatch(/hidden/i)
  })
})

describe('approvalDataHex', () => {
  it('encodes bytes as lower-case hex', () => {
    expect(approvalDataHex(new Uint8Array([0xab, 0x01]))).toBe('ab01')
    expect(approvalDataHex(new Uint8Array())).toBe('')
  })
})

describe('dataTextView', () => {
  const USER = testUser()
  const bytes = (text: string) => new TextEncoder().encode(text)
  const shown = (view: ReturnType<typeof dataTextView>) =>
    view?.parts.map((part) => part.text).join('')

  function testUser() {
    return 'z1qqvj7fyj40janwaqket2fnen4lp5k5synjaf6l'
  }

  it('shows UTF-8 text sent to a user address', () => {
    const view = dataTextView(USER, bytes('hello \u00e9 \u{1F31F}'))

    expect(shown(view)).toBe('hello \u00e9 \u{1F31F}')
    expect(view).toMatchObject({ json: false, hiddenCharCount: 0 })
  })

  it('returns null for data that is not well-formed UTF-8', () => {
    for (const bad of [
      [0xff, 0x7a],
      [0x80],
      [0xc0, 0xaf],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
    ]) {
      expect(dataTextView(USER, Uint8Array.from(bad))).toBeNull()
    }
  })

  it('returns null for empty data and for an embedded contract destination', () => {
    expect(dataTextView(USER, new Uint8Array())).toBeNull()
    expect(dataTextView(PILLAR, bytes('hello'))).toBeNull()
    expect(dataTextView(PILLAR, bytes('{"a":1}'))).toBeNull()
  })

  it('labels hidden code points as U+XXXX', () => {
    const view = dataTextView(USER, bytes('pay\u202Eevil\u200B\u0000'))

    expect(view?.parts).toEqual([
      { text: 'pay', hidden: false },
      { text: 'U+202E', hidden: true },
      { text: 'evil', hidden: false },
      { text: 'U+200B', hidden: true },
      { text: 'U+0000', hidden: true },
    ])
    expect(view?.hiddenCharCount).toBe(3)
  })

  it('labels a byte order mark rather than dropping it', () => {
    expect(dataTextView(USER, Uint8Array.from([0xef, 0xbb, 0xbf, 0x61]))?.parts[0]).toEqual({
      text: 'U+FEFF',
      hidden: true,
    })
  })

  describe('JSON', () => {
    it('pretty-prints a compact object', () => {
      const view = dataTextView(USER, bytes('{"p":"zrc-321","op":{"a":[1,2]}}'))

      expect(view?.json).toBe(true)
      expect(shown(view)).toBe(JSON.stringify({ p: 'zrc-321', op: { a: [1, 2] } }, null, 2))
    })

    it('pretty-prints an object that already has whitespace', () => {
      expect(dataTextView(USER, bytes('{ "a" : 1 ,\n "b" : "x y" }'))?.json).toBe(true)
    })

    it('keeps hidden code points inside a JSON string labelled', () => {
      const view = dataTextView(USER, bytes('{"a":"x\u202Ey"}'))

      expect(view?.json).toBe(true)
      expect(view?.hiddenCharCount).toBe(1)
    })

    it.each([
      ['an array', '[1,2]'],
      ['a scalar', '5'],
      ['plain text', 'not json'],
      ['a duplicate key', '{"a":1,"a":2}'],
      ['a number JSON would round', '{"a":12345678901234567890}'],
      ['an escape the pretty print would rewrite', '{"a":"\\u0041"}'],
      ['a float written differently', '{"a":1.0}'],
      ['invalid JSON', '{"a":'],
    ])('shows %s as it is', (_name, text) => {
      const view = dataTextView(USER, bytes(text))

      expect(view?.json).toBe(false)
      expect(shown(view)).toBe(text)
    })

    it('shows an object nested past the depth cap as plain text', () => {
      const deep = (levels: number) => '{"a":'.repeat(levels) + '1' + '}'.repeat(levels)

      expect(dataTextView(USER, bytes(deep(MAX_JSON_DEPTH)))?.json).toBe(true)
      const over = dataTextView(USER, bytes(deep(MAX_JSON_DEPTH + 1)))
      expect(over?.json).toBe(false)
      expect(shown(over)).toBe(deep(MAX_JSON_DEPTH + 1))
    })

    it('shows an object with more separators than the cap as plain text', () => {
      const wide = (keys: number) =>
        '{' + Array.from({ length: keys }, (_, i) => `"k${i}":1`).join(',') + '}'
      // Each key adds a colon and a comma, except the last comma.
      const within = MAX_JSON_TOKENS / 2
      expect(dataTextView(USER, bytes(wide(within)))?.json).toBe(true)
      expect(dataTextView(USER, bytes(wide(within + 1)))?.json).toBe(false)
    })

    it('does not throw on a very deep payload of the largest size', () => {
      const text = '['.repeat(16384)

      expect(dataTextView(USER, bytes(text))?.json).toBe(false)
    })
  })
})

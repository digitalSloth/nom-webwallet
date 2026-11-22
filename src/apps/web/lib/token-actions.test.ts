import { describe, expect, it } from 'vitest'
import { Address, QSR_ZTS, TOKEN_ADDRESS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { Token } from 'znn-typescript-sdk'
import { formatAmount } from '@/shared/lib/amount'
import { must } from '@/test/must'
import type { BalanceInfo } from '@/types'
import {
  actionKey,
  addressWarning,
  burnChoices,
  burnMeta,
  canBurn,
  canonicalAddress,
  checkUpdate,
  heldBalance,
  mintMeta,
  parseBurn,
  parseMint,
  tokenFacts,
  updateMeta,
} from './token-actions'
import type { TokenFacts, UpdateForm } from './token-actions'

const user = (n: number) => Address.fromPublicKey(Buffer.alloc(32, n)).toString()
const ME = user(1)
const SECOND = user(2)
const OUTSIDE = user(3)
const OTHER_OWNER = user(4)
const CONTRACT = TOKEN_ADDRESS.toString()
const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()
const ZTS = 'zts1abcdefghijklmnopqrst'
const MAX_RAW = 2n ** 255n - 1n
const ctx = { active: ME, ownAccounts: [ME, SECOND] }

const facts = (over: Partial<TokenFacts> = {}): TokenFacts => ({
  tokenStandard: ZTS,
  name: 'Test token',
  symbol: 'TST',
  decimals: 8,
  owner: ME,
  totalSupply: 1_000_00000000n,
  maxSupply: 2_000_00000000n,
  isMintable: true,
  isBurnable: false,
  ...over,
})

const balance = (zts: string, symbol: string, amount: string): BalanceInfo => ({
  tokenStandard: zts,
  balance: amount,
  decimals: 8,
  symbol,
  name: symbol,
})

describe('tokenFacts', () => {
  it('reads strings from the SDK token and keeps bigints raw', () => {
    const t = {
      tokenStandard: { toString: () => ZTS },
      name: 'N',
      symbol: 'S',
      decimals: 18,
      owner: { toString: () => ME },
      totalSupply: MAX_RAW,
      maxSupply: MAX_RAW,
      isMintable: true,
      isBurnable: false,
      isUtility: true,
    } as unknown as Token

    expect(tokenFacts(t)).toEqual({
      tokenStandard: ZTS,
      name: 'N',
      symbol: 'S',
      decimals: 18,
      owner: ME,
      totalSupply: MAX_RAW,
      maxSupply: MAX_RAW,
      isMintable: true,
      isBurnable: false,
    })
  })
})

describe('canonicalAddress and addressWarning', () => {
  it('trims and lower-cases', () => {
    expect(canonicalAddress(`  ${ME.toUpperCase()}  `)).toBe(ME)
    expect(canonicalAddress(ME)).toBe(ME)
  })

  it('gives null for invalid text', () => {
    expect(canonicalAddress('')).toBeNull()
    expect(canonicalAddress('z1notanaddress')).toBeNull()
    expect(canonicalAddress(ME.slice(0, -1))).toBeNull()
  })

  it('flags a contract address, also from upper-case input', () => {
    expect(addressWarning(CONTRACT, [ME])).toBe('contract')
    const upper = must(canonicalAddress(CONTRACT.toUpperCase()))
    expect(upper).toBe(CONTRACT)
    expect(addressWarning(upper, [ME])).toBe('contract')
  })

  it('flags an address outside the accounts and passes an own account', () => {
    expect(addressWarning(OUTSIDE, [ME, SECOND])).toBe('foreign')
    expect(addressWarning(SECOND, [ME, SECOND])).toBeNull()
  })
})

describe('parseMint', () => {
  const remaining = 1_000_00000000n
  const form = (amount: string, to = ME) => ({ amount, to })

  it('accepts the exact remaining amount', () => {
    const r = parseMint(form('1000'), facts(), ctx)
    expect(r.errors).toEqual({})
    expect(r.blocked).toBeNull()
    expect(r.remaining).toBe(remaining)
    expect(r.params).toEqual({ tokenStandard: ZTS, amount: remaining, receiveAddress: ME })
    expect(r.toWarning).toBeNull()
  })

  it('refuses one raw unit above the remaining amount', () => {
    const r = parseMint(form('1000.00000001'), facts(), ctx)
    expect(r.errors.amount).toContain('can still be minted')
    expect(r.errors.amount).toContain('1,000 TST')
    expect(r.params).toBeNull()
  })

  it('accepts one raw unit below the remaining amount', () => {
    const r = parseMint(form('999.99999999'), facts(), ctx)
    expect(must(r.params).amount).toBe(remaining - 1n)
  })

  it('refuses zero and a fraction at 0 decimals', () => {
    const zero = parseMint(
      form('0'),
      facts({ decimals: 0, maxSupply: 2000n, totalSupply: 1000n }),
      ctx
    )
    expect(zero.errors.amount).toBe('Enter an amount above 0')
    expect(zero.params).toBeNull()
    const fraction = parseMint(
      form('1.5'),
      facts({ decimals: 0, maxSupply: 2000n, totalSupply: 1000n }),
      ctx
    )
    expect(fraction.errors.amount).toBe('Enter a valid amount (up to 0 decimals)')
    expect(fraction.params).toBeNull()
  })

  it.each(['50,000', '-1', '1e3', 'abc'])('refuses the malformed amount %s', (amount) => {
    const r = parseMint(form(amount), facts(), ctx)
    expect(r.errors.amount).toBe('Enter a valid amount (up to 8 decimals)')
    expect(r.params).toBeNull()
  })

  it('refuses more fraction digits than the decimals', () => {
    const r = parseMint(form('1.123456789'), facts(), ctx)
    expect(r.errors.amount).toBe('Enter a valid amount (up to 8 decimals)')
  })

  it('gives no error and null params for empty fields', () => {
    for (const f of [form('', ME), form('1', ''), form('  ', '  ')]) {
      const r = parseMint(f, facts(), ctx)
      expect(r.params).toBeNull()
      expect(r.errors.to).toBeUndefined()
    }
    expect(parseMint(form(''), facts(), ctx).errors).toEqual({})
    expect(parseMint(form('1', ''), facts(), ctx).errors).toEqual({})
  })

  it('blocks a non-owner', () => {
    const r = parseMint(form('1'), facts({ owner: OTHER_OWNER }), ctx)
    expect(r.blocked).toBe('You no longer own this token.')
    expect(r.params).toBeNull()
  })

  it('blocks a token that is not mintable, even for the owner', () => {
    const r = parseMint(form('1'), facts({ isMintable: false }), ctx)
    expect(r.blocked).toBe("This token isn't mintable.")
    expect(r.params).toBeNull()
  })

  it('blocks a token at its max supply and reports a zero remainder', () => {
    const r = parseMint(form('1'), facts({ totalSupply: 5n, maxSupply: 5n }), ctx)
    expect(r.blocked).toBe('This token is at its max supply.')
    expect(r.remaining).toBe(0n)
    expect(r.params).toBeNull()
  })

  it('never reports a negative remainder', () => {
    const r = parseMint(form('1'), facts({ totalSupply: 9n, maxSupply: 5n }), ctx)
    expect(r.remaining).toBe(0n)
    expect(r.params).toBeNull()
  })

  it('refuses an invalid recipient', () => {
    const r = parseMint(form('1', 'z1nope'), facts(), ctx)
    expect(r.errors.to).toBe('Enter a valid z1 address')
    expect(r.params).toBeNull()
  })

  it('refuses a contract recipient, also in upper case', () => {
    for (const to of [CONTRACT, CONTRACT.toUpperCase(), ` ${CONTRACT} `]) {
      const r = parseMint(form('1', to), facts(), ctx)
      expect(r.errors.to).toBe("Tokens can't be minted to a contract address.")
      expect(r.params).toBeNull()
    }
  })

  it('warns for a recipient outside the accounts and still gives params', () => {
    const r = parseMint(form('1', OUTSIDE), facts(), ctx)
    expect(r.toWarning).toBe(
      "This address isn't one of your accounts. Minted tokens sent to a wrong address are lost."
    )
    expect(must(r.params).receiveAddress).toBe(OUTSIDE)
  })

  it('canonicalises an upper-case own recipient with no warning', () => {
    const r = parseMint(form('1', ` ${SECOND.toUpperCase()}`), facts(), ctx)
    expect(r.toWarning).toBeNull()
    expect(must(r.params).receiveAddress).toBe(SECOND)
  })

  it('mints the full remainder of a 2^255 - 1 max supply at 18 decimals', () => {
    const t = facts({ decimals: 18, totalSupply: 0n, maxSupply: MAX_RAW })
    const full = parseMint(form(formatAmount(MAX_RAW, 18)), t, ctx)
    expect(full.remaining).toBe(MAX_RAW)
    expect(must(full.params).amount).toBe(MAX_RAW)
    const over = parseMint(form(formatAmount(MAX_RAW + 1n, 18)), t, ctx)
    expect(over.errors.amount).toContain('can still be minted')
    expect(over.params).toBeNull()
  })

  it('bounds the amount by the remainder, not the max supply', () => {
    const t = facts({ totalSupply: 1500_00000000n })
    expect(parseMint(form('500'), t, ctx).params).not.toBeNull()
    expect(parseMint(form('500.00000001'), t, ctx).params).toBeNull()
  })
})

describe('canBurn and parseBurn', () => {
  const held = 10_00000000n

  it('lets the owner burn a token that is not burnable', () => {
    const t = facts({ owner: ME, isBurnable: false })
    expect(canBurn(t, ME)).toBe(true)
    expect(must(parseBurn('1', t, held, ME).params).amount).toBe(1_00000000n)
  })

  it('lets a non-owner burn a burnable token', () => {
    const t = facts({ owner: OTHER_OWNER, isBurnable: true })
    expect(canBurn(t, ME)).toBe(true)
    expect(parseBurn('1', t, held, ME).params).not.toBeNull()
  })

  it('blocks a non-owner on a token that is not burnable', () => {
    const t = facts({ owner: OTHER_OWNER, isBurnable: false })
    expect(canBurn(t, ME)).toBe(false)
    const r = parseBurn('1', t, held, ME)
    expect(r.blocked).toBe('Only the owner can burn this token.')
    expect(r.params).toBeNull()
  })

  it.each([
    ['ZNN', ZNN],
    ['QSR', QSR],
  ])('blocks %s by standard even for an owner of a burnable token', (_n, zts) => {
    const r = parseBurn('1', facts({ tokenStandard: zts, owner: ME, isBurnable: true }), held, ME)
    expect(r.blocked).toBe("ZNN and QSR can't be burned from this wallet.")
    expect(r.params).toBeNull()
  })

  it('does not block a token that only has the symbol ZNN', () => {
    const r = parseBurn('1', facts({ symbol: 'ZNN', isBurnable: true }), held, ME)
    expect(r.blocked).toBeNull()
    expect(r.params).not.toBeNull()
  })

  it('accepts the exact balance and refuses one raw unit more', () => {
    const t = facts({ isBurnable: true })
    expect(must(parseBurn('10', t, held, ME).params).amount).toBe(held)
    const over = parseBurn('10.00000001', t, held, ME)
    expect(over.error).toBe('Insufficient balance')
    expect(over.params).toBeNull()
  })

  it('refuses every amount when the balance is 0', () => {
    const r = parseBurn('0.00000001', facts({ isBurnable: true }), 0n, ME)
    expect(r.error).toBe('Insufficient balance')
    expect(r.params).toBeNull()
  })

  it('gives null params and no error while the balance is unknown', () => {
    const r = parseBurn('1', facts({ isBurnable: true }), null, ME)
    expect(r.params).toBeNull()
    expect(r.error).toBeNull()
  })

  it('refuses zero and malformed amounts', () => {
    const t = facts({ isBurnable: true })
    expect(parseBurn('0', t, held, ME).error).toBe('Enter an amount above 0')
    for (const bad of ['-1', '1e3', '1,000', '1.123456789']) {
      const r = parseBurn(bad, t, held, ME)
      expect(r.error).toBe('Enter a valid amount (up to 8 decimals)')
      expect(r.params).toBeNull()
    }
  })

  it('gives no error for an empty amount', () => {
    const r = parseBurn('  ', facts({ isBurnable: true }), held, ME)
    expect(r.error).toBeNull()
    expect(r.params).toBeNull()
  })

  it('burns the full balance of a 2^255 - 1 holding at 18 decimals', () => {
    const t = facts({ decimals: 18, isBurnable: true })
    expect(must(parseBurn(formatAmount(MAX_RAW, 18), t, MAX_RAW, ME).params).amount).toBe(MAX_RAW)
    expect(parseBurn(formatAmount(MAX_RAW, 18), t, MAX_RAW - 1n, ME).params).toBeNull()
  })

  it('reducesMax follows isMintable', () => {
    expect(
      parseBurn('1', facts({ isBurnable: true, isMintable: false }), held, ME).reducesMax
    ).toBe(true)
    expect(parseBurn('1', facts({ isBurnable: true, isMintable: true }), held, ME).reducesMax).toBe(
      false
    )
  })
})

describe('checkUpdate', () => {
  const t = facts({ isMintable: true, isBurnable: false })
  const same = (over: Partial<UpdateForm> = {}): UpdateForm => ({
    owner: ME,
    mintable: true,
    burnable: false,
    confirmedOwner: null,
    mintOffConfirmed: false,
    ...over,
  })

  it('is not changed and not ready for identical values', () => {
    const r = checkUpdate(same(), t, ctx)
    expect(r.changed).toBe(false)
    expect(r.ready).toBe(false)
    expect(r.ownerChanged).toBe(false)
    expect(r.errors).toEqual({})
  })

  it('treats the owner set back to the current owner as unchanged, even upper-case', () => {
    const r = checkUpdate(same({ owner: ` ${ME.toUpperCase()} ` }), t, ctx)
    expect(r.ownerChanged).toBe(false)
    expect(r.changed).toBe(false)
  })

  it('is ready for a burnable-only change with no confirmation', () => {
    const r = checkUpdate(same({ burnable: true }), t, ctx)
    expect(r.burnableChanged).toBe(true)
    expect(r.ready).toBe(true)
    expect(must(r.params)).toEqual({
      tokenStandard: ZTS,
      owner: ME,
      mintable: true,
      burnable: true,
    })
  })

  it('needs the owner tick box for a new owner', () => {
    const r = checkUpdate(same({ owner: SECOND }), t, ctx)
    expect(r.ownerChanged).toBe(true)
    expect(r.params).not.toBeNull()
    expect(r.ready).toBe(false)
  })

  it('is ready when the tick box names the canonical new owner', () => {
    const r = checkUpdate(same({ owner: SECOND, confirmedOwner: SECOND }), t, ctx)
    expect(r.ready).toBe(true)
    expect(must(r.params).owner).toBe(SECOND)
  })

  it('binds the confirmation to the normalised address, so upper-case input still matches', () => {
    const r = checkUpdate(
      same({ owner: ` ${SECOND.toUpperCase()}`, confirmedOwner: SECOND }),
      t,
      ctx
    )
    expect(r.ready).toBe(true)
    expect(must(r.params).owner).toBe(SECOND)
  })

  it('is not ready when the confirmation names another address', () => {
    const r = checkUpdate(same({ owner: SECOND, confirmedOwner: OUTSIDE }), t, ctx)
    expect(r.ready).toBe(false)
  })

  it('un-confirms when the address is edited after ticking', () => {
    const ticked = same({ owner: OUTSIDE, confirmedOwner: OUTSIDE })
    expect(checkUpdate(ticked, t, ctx).ready).toBe(true)
    expect(checkUpdate({ ...ticked, owner: OTHER_OWNER }, t, ctx).ready).toBe(false)
  })

  it('warns for a new owner outside the accounts and not for an own account', () => {
    const foreign = checkUpdate(same({ owner: OUTSIDE }), t, ctx)
    expect(foreign.ownerWarning).toBe(
      "This address isn't one of your accounts. After this change, only its holder can mint and manage this token."
    )
    expect(checkUpdate(same({ owner: SECOND }), t, ctx).ownerWarning).toBeNull()
    expect(checkUpdate(same(), t, ctx).ownerWarning).toBeNull()
  })

  it('refuses a contract owner, also in upper case, with no params', () => {
    for (const owner of [CONTRACT, CONTRACT.toUpperCase()]) {
      const r = checkUpdate(same({ owner, confirmedOwner: CONTRACT }), t, ctx)
      expect(r.errors.owner).toBe("A contract address can't own a token.")
      expect(r.params).toBeNull()
      expect(r.ready).toBe(false)
    }
  })

  it('refuses an invalid owner and gives no error for an empty one', () => {
    const bad = checkUpdate(same({ owner: 'z1nope' }), t, ctx)
    expect(bad.errors.owner).toBe('Enter a valid z1 address')
    expect(bad.params).toBeNull()
    const empty = checkUpdate(same({ owner: '' }), t, ctx)
    expect(empty.errors.owner).toBeUndefined()
    expect(empty.params).toBeNull()
    expect(empty.ready).toBe(false)
  })

  it('needs the mintable tick box to turn minting off', () => {
    const r = checkUpdate(same({ mintable: false }), t, ctx)
    expect(r.disablesMint).toBe(true)
    expect(r.changed).toBe(true)
    expect(r.ready).toBe(false)
    expect(checkUpdate(same({ mintable: false, mintOffConfirmed: true }), t, ctx).ready).toBe(true)
  })

  it('needs both tick boxes when the owner changes and minting turns off', () => {
    const base = same({ owner: SECOND, mintable: false })
    expect(checkUpdate({ ...base, confirmedOwner: SECOND }, t, ctx).ready).toBe(false)
    expect(checkUpdate({ ...base, mintOffConfirmed: true }, t, ctx).ready).toBe(false)
    expect(
      checkUpdate({ ...base, confirmedOwner: SECOND, mintOffConfirmed: true }, t, ctx).ready
    ).toBe(true)
  })

  it('refuses turning minting back on', () => {
    const off = facts({ isMintable: false })
    const r = checkUpdate(same({ mintable: true, burnable: true }), off, ctx)
    expect(r.errors.mintable).toBe("Minting can't be turned back on.")
    expect(r.params).toBeNull()
    expect(r.ready).toBe(false)
  })

  it('does not call keeping minting off a change', () => {
    const off = facts({ isMintable: false })
    const r = checkUpdate(same({ mintable: false }), off, ctx)
    expect(r.disablesMint).toBe(false)
    expect(r.changed).toBe(false)
  })

  it('blocks a non-owner', () => {
    const r = checkUpdate(same({ burnable: true }), facts({ owner: OTHER_OWNER }), ctx)
    expect(r.blocked).toBe('You no longer own this token.')
    expect(r.params).toBeNull()
    expect(r.ready).toBe(false)
  })
})

describe('metas and keys', () => {
  const mint = { tokenStandard: ZTS, amount: 15_00000000n, receiveAddress: OUTSIDE }

  it('builds the mint meta', () => {
    expect(mintMeta(mint, facts())).toEqual({
      kind: 'contract',
      title: 'Token · Mint 15 TST',
      progress: 'Minting 15 TST',
      amount: '1500000000',
      decimals: 8,
      symbol: 'TST',
      tokenStandard: ZTS,
      recipient: OUTSIDE,
    })
  })

  it('builds the burn meta with no recipient', () => {
    const meta = burnMeta({ tokenStandard: ZTS, amount: 1n }, facts())
    expect(meta).toEqual({
      kind: 'contract',
      title: 'Token · Burn 0.00000001 TST',
      progress: 'Burning 0.00000001 TST',
      amount: '1',
      decimals: 8,
      symbol: 'TST',
      tokenStandard: ZTS,
    })
    expect('recipient' in meta).toBe(false)
  })

  it('keeps every digit of a 2^255 - 1 amount in the meta', () => {
    const t = facts({ decimals: 18 })
    const meta = mintMeta({ ...mint, amount: MAX_RAW }, t)
    expect(meta.amount).toBe(MAX_RAW.toString())
    expect(meta.title).toBe(`Token · Mint ${formatAmount(MAX_RAW, 18)} TST`)
  })

  it('builds the update meta with a recipient only for an owner change', () => {
    const changed = updateMeta(
      { tokenStandard: ZTS, owner: SECOND, mintable: true, burnable: false },
      facts()
    )
    expect(changed).toEqual({
      kind: 'contract',
      title: 'Token · Manage TST',
      progress: 'Updating TST',
      recipient: SECOND,
    })
    const same = updateMeta(
      { tokenStandard: ZTS, owner: ME, mintable: false, burnable: false },
      facts()
    )
    expect(same).toEqual({
      kind: 'contract',
      title: 'Token · Manage TST',
      progress: 'Updating TST',
    })
    expect('recipient' in same).toBe(false)
  })

  it('builds one key per mode, account and token', () => {
    expect(actionKey('mint', ME, ZTS)).toBe(`token-mint:${ME}:${ZTS}`)
    expect(actionKey('burn', ME, ZTS)).toBe(`token-burn:${ME}:${ZTS}`)
    expect(actionKey('manage', ME, ZTS)).toBe(`token-update:${ME}:${ZTS}`)
    expect(actionKey('burn', SECOND, ZTS)).not.toBe(actionKey('burn', ME, ZTS))
  })
})

describe('burnChoices and heldBalance', () => {
  it('drops ZNN and QSR by standard, keeps a ZNN symbol under another standard, drops zero', () => {
    const list = [
      balance(ZNN, 'ZNN', '100'),
      balance(QSR, 'QSR', '100'),
      balance('zts1fakeznnxxxxxxxxxxxxx', 'ZNN', '5'),
      balance('zts1emptyxxxxxxxxxxxxxxx', 'EMP', '0'),
      balance('zts1otherxxxxxxxxxxxxxxx', 'OTH', '7'),
    ]
    const choices = burnChoices(list)
    expect(choices.map((c) => c.tokenStandard).sort()).toEqual(
      ['zts1fakeznnxxxxxxxxxxxxx', 'zts1otherxxxxxxxxxxxxxxx'].sort()
    )
  })

  it('is empty for an empty list', () => {
    expect(burnChoices([])).toEqual([])
  })

  it('is null while loading with no balances', () => {
    expect(heldBalance([], ZTS, true)).toBeNull()
  })

  it('is 0n for a missing token once loaded, and while loading with other balances', () => {
    expect(heldBalance([], ZTS, false)).toBe(0n)
    expect(heldBalance([balance('zts1other', 'OTH', '1')], ZTS, true)).toBe(0n)
  })

  it('reads a held balance as a bigint without precision loss', () => {
    const raw = MAX_RAW.toString()
    expect(heldBalance([balance(ZTS, 'TST', raw)], ZTS, false)).toBe(MAX_RAW)
  })
})

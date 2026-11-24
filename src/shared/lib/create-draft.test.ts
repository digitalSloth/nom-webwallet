import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'

const VALID_12 = `${Array(11).fill('abandon').join(' ')} about`

type Draft = typeof import('./create-draft')
let d: Draft

beforeEach(async () => {
  vi.resetModules()
  d = await import('./create-draft')
})

describe('create draft', () => {
  it('has no draft initially', () => {
    expect(d.getSetupDraft()).toBeNull()
  })

  it('returns the same 24-word phrase on repeated ensureCreateMnemonic', () => {
    d.setCreatePassword('Main', 'pw')

    const first = d.ensureCreateMnemonic()
    const second = d.ensureCreateMnemonic()

    expect(first.split(' ')).toHaveLength(24)
    expect(second).toBe(first)
  })

  it('keeps the phrase and updates name and password on a second setCreatePassword', () => {
    d.setCreatePassword('Main', 'pw')
    const phrase = d.ensureCreateMnemonic()

    d.setCreatePassword('Renamed', 'pw2')

    expect(d.getSetupDraft()).toEqual({
      kind: 'create',
      name: 'Renamed',
      password: 'pw2',
      mnemonic: phrase,
    })
  })

  it('does not generate a phrase until asked', () => {
    d.setCreatePassword('Main', 'pw')

    expect(d.getSetupDraft()).toMatchObject({ kind: 'create', mnemonic: null })
  })

  it('throws from ensureCreateMnemonic without a create draft', () => {
    expect(() => d.ensureCreateMnemonic()).toThrow('No wallet is being created')
    d.startImportDraft(VALID_12)
    expect(() => d.ensureCreateMnemonic()).toThrow('No wallet is being created')
  })

  it('stores an import phrase with the base address the SDK derives', () => {
    d.startImportDraft(VALID_12)

    expect(d.getSetupDraft()).toEqual({
      kind: 'import',
      phrase: VALID_12,
      baseAddress: KeyStore.fromMnemonic(VALID_12).getBaseAddress().toString(),
    })
  })

  it('never writes the draft to browser storage', () => {
    // Stubbed rather than spied on Storage.prototype: Node defines Web
    // Storage globals only from version 25.
    const setItem = vi.fn()
    const storage = { setItem, getItem: vi.fn(() => null), removeItem: vi.fn(), clear: vi.fn() }
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('sessionStorage', storage)
    try {
      d.setCreatePassword('Main', 'pw')
      d.ensureCreateMnemonic()
      d.startImportDraft(VALID_12)

      expect(setItem).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    ['create-verify', false],
    ['create-password', false],
    ['create-phrase', false],
    ['import-phrase', true],
    ['home', true],
    [undefined, true],
  ])('a create draft on route %s is cleared: %s', (route, cleared) => {
    d.setCreatePassword('Main', 'pw')

    d.clearSetupDraftOutside(route)

    expect(d.getSetupDraft() === null).toBe(cleared)
  })

  it.each([
    ['import-password', false],
    ['import-phrase', false],
    ['create-password', true],
    ['home', true],
    [undefined, true],
  ])('an import draft on route %s is cleared: %s', (route, cleared) => {
    d.startImportDraft(VALID_12)

    d.clearSetupDraftOutside(route)

    expect(d.getSetupDraft() === null).toBe(cleared)
  })

  it('clearSetupDraft drops the draft', () => {
    d.setCreatePassword('Main', 'pw')
    d.clearSetupDraft()

    expect(d.getSetupDraft()).toBeNull()
  })
})

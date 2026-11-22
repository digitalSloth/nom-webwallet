import { KeyStore } from 'znn-typescript-sdk'

export type SetupDraft =
  | { kind: 'create'; name: string; password: string; mnemonic: string | null }
  | { kind: 'import'; phrase: string; baseAddress: string }

export const CREATE_ROUTES: readonly string[] = [
  'create-password',
  'create-phrase',
  'create-verify',
]
export const IMPORT_ROUTES: readonly string[] = ['import-phrase', 'import-password']

// The phrase and password live only here and in page refs. A plain variable
// keeps them out of Vue reactivity, storage and logs.
let draft: SetupDraft | null = null

export function getSetupDraft(): Readonly<SetupDraft> | null {
  return draft
}

/** Stores the step 1 values. An existing create draft keeps its phrase. */
export function setCreatePassword(name: string, password: string): void {
  if (draft?.kind === 'create') {
    draft = { ...draft, name, password }
  } else {
    draft = { kind: 'create', name, password, mnemonic: null }
  }
}

/** Returns the draft's 24-word phrase, generating it on first use. */
export function ensureCreateMnemonic(): string {
  if (draft?.kind !== 'create') throw new Error('No wallet is being created')
  draft.mnemonic ??= KeyStore.newRandom().mnemonic
  return draft.mnemonic
}

/** Stores a phrase that checkPhrase marked valid. */
export function startImportDraft(phrase: string): void {
  draft = {
    kind: 'import',
    phrase,
    baseAddress: KeyStore.fromMnemonic(phrase).getBaseAddress().toString(),
  }
}

export function clearSetupDraft(): void {
  draft = null
}

/** Clears the draft unless the route belongs to the flow that owns it. */
export function clearSetupDraftOutside(routeName: unknown): void {
  const flow =
    draft?.kind === 'create' ? CREATE_ROUTES : draft?.kind === 'import' ? IMPORT_ROUTES : []
  if (typeof routeName !== 'string' || !flow.includes(routeName)) draft = null
}

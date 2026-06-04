# Encrypted-Wallet Hardening — Design Spec

**Date:** 2026-06-04
**Branch:** `fix/wallet-encryption-hardening` (off `main`)
**Status:** Approved design, ready for implementation planning

## Summary

Address a High-severity PR finding: a weak offline brute-force boundary for
encrypted wallets. Encrypted keyfiles are persisted to browser storage
(`wallet-service.ts`, `local-storage-adapter.ts`), but the app only requires
8-character passwords (`config.ts`) and the SDK's Argon2id KDF uses `timeCost: 1`
(`znn-typescript-sdk` `keyFile.js`). If an attacker exfiltrates the encrypted
keyfile, the in-memory unlock throttling in `wallet-service.ts` does not help —
the attack is offline.

Two coordinated fixes close the gap:

- **Part A — Passphrase strength:** raise the floor and add a strength meter/entropy
  estimate, enforced at wallet creation and import. This is the primary lever: a
  high-entropy passphrase makes offline brute-force infeasible regardless of KDF.
- **Part B — KDF cost:** raise Argon2id `timeCost` for new wallets and transparently
  upgrade existing wallets on next unlock, as defense-in-depth (raises per-guess
  cost).

## Goals

- Reject low-entropy passphrases at create/import with clear, live feedback.
- Materially increase the Argon2id work factor for all wallets over time.
- Migrate existing wallets without data loss and without user action.

## Non-Goals (YAGNI)

- No common-password blocklist (explicitly excluded).
- No third-party strength library (zxcvbn) — keep the bundle lean for the extension.
- No patching/forking of `znn-typescript-sdk`.
- No re-scoring of passphrases at unlock (only create/import enforce the floor).
- No change to the existing in-memory unlock throttling.

## Threat model note

The fix targets the **offline** attack: attacker has the encrypted keyfile JSON
and brute-forces the passphrase locally. The two defenses multiply: passphrase
entropy sets the size of the search space; KDF cost sets the time per guess. The
passphrase floor is the dominant factor and is applied to all new/imported
wallets immediately; the KDF bump is a constant-factor hardening migrated in over
time.

---

## Part A — Passphrase strength

### `src/core/password-strength.ts` (new, pure, no Vue)

Single source of truth, replacing the duplicated `password.length >= 8` checks in
the two forms.

```ts
export interface PasswordStrength {
  bits: number            // estimated entropy
  score: 0 | 1 | 2 | 3 | 4
  label: 'Very weak' | 'Weak' | 'Fair' | 'Good' | 'Strong'
  meetsFloor: boolean     // length >= MIN_PASSWORD_LENGTH && score >= MIN_PASSWORD_SCORE
  suggestions: string[]   // shown to help the user clear the floor
}

export function estimatePasswordStrength(password: string): PasswordStrength
```

**Entropy estimate (lightweight, no dictionary):**
- Determine which character pools the password uses: lowercase (26), uppercase
  (26), digits (10), symbols (32). `poolSize` = sum of pools present.
- `bits = password.length * log2(poolSize)` (0 for an empty password / poolSize ≤ 1).

**Score buckets (by bits):** `< 40` → 0 (Very weak), `40–59` → 1 (Weak), `60–79`
→ 2 (Fair), `80–99` → 3 (Good), `>= 100` → 4 (Strong).

**Floor:** `meetsFloor = password.length >= MIN_PASSWORD_LENGTH && score >= MIN_PASSWORD_SCORE`.

**Suggestions:** derive from what's missing, e.g. `Use at least ${MIN_PASSWORD_LENGTH}
characters` when too short; `Mix in uppercase, numbers, or symbols` when pool
variety is low. Return an empty array when `meetsFloor` is true.

### `src/config.ts`

- Change `MIN_PASSWORD_LENGTH` from `8` to `12`.
- Add `MIN_PASSWORD_SCORE = 2` (the "Fair" bucket — the minimum score allowed to
  create/import).
- Add `PASSWORD_STRENGTH_LABELS` (the five score labels) for reuse by the meter.

### `src/components/PasswordStrengthMeter.vue` (new)

Presentational component shared by both forms.
- Prop: `strength: PasswordStrength` — the parent computes the estimate and passes
  it in, keeping this component pure (no estimation logic inside).
- Renders: a 4-segment bar colored by score (red → amber → green), the `label`,
  and the first `suggestion` (if any) as muted helper text.
- No logic beyond display.

### `CreateWalletForm.vue` and `ImportWalletForm.vue`

Both currently compute `passwordStrong = password.length >= MIN_PASSWORD_LENGTH`.
Replace with:
- `const strength = computed(() => estimatePasswordStrength(password.value))`
- Use `strength.value.meetsFloor` everywhere `passwordStrong` was used (submit
  `:disabled`, the pre-submit guard, and the inline warning).
- Render `<PasswordStrengthMeter :strength="strength" />` under the password field
  (only when `password` is non-empty).
- Update the static hint text from "at least 8 characters" to reflect the new
  floor (min length + "Fair or better").

The unlock dialog (`UnlockWalletDialog.vue`) is unchanged.

---

## Part B — KDF cost + migration (no-patch orchestration)

### Background

`KeyFile.hashPassword` reads a static `KeyFile.DEFAULT_CONFIG` at hash time, and
the encrypted keyfile JSON persists only the `salt` (not the Argon2 params). So
decryption always uses whatever `DEFAULT_CONFIG` holds at decrypt time. Naively
raising the static would break every existing wallet (different derived key →
decrypt fails). We therefore orchestrate the static per operation and record each
wallet's KDF version in our own storage.

### `src/config.ts`

```ts
export interface KdfParams {
  timeCost: number
  memoryCost: number   // KiB
  hashLength: number
  parallelism: number
}

// Legacy params — must match the SDK's historical KeyFile.DEFAULT_CONFIG exactly.
export const KDF_PARAMS_V1: KdfParams = {
  timeCost: 1, memoryCost: 64 * 1024, hashLength: 32, parallelism: 4
}

// Strong params for new/upgraded wallets. timeCost is the starting target;
// tune during implementation to keep unlock under ~1.5s in argon2-browser (WASM).
export const KDF_PARAMS_V2: KdfParams = {
  timeCost: 3, memoryCost: 64 * 1024, hashLength: 32, parallelism: 4
}

export const CURRENT_KDF_VERSION = 2

export function kdfParamsForVersion(version: number | undefined): KdfParams {
  return version === 2 ? KDF_PARAMS_V2 : KDF_PARAMS_V1
}
```

### `src/core/kdf.ts` (new)

The single place that mutates the SDK static. Sets `KeyFile.DEFAULT_CONFIG`,
awaits the operation, restores the previous value in `finally`.

```ts
import { KeyFile } from 'znn-typescript-sdk'
import type { KdfParams } from '@/config'

export async function withKdfParams<T>(params: KdfParams, fn: () => Promise<T>): Promise<T> {
  const previous = KeyFile.DEFAULT_CONFIG
  KeyFile.DEFAULT_CONFIG = { ...params, type: 2 } // Argon2id
  try {
    return await fn()
  } finally {
    KeyFile.DEFAULT_CONFIG = previous
  }
}
```

Wallet operations are user-driven and serialized, so there is no concurrent
encrypt/decrypt with differing params. (A mutex is possible but unnecessary; note
it as optional.) Verify `KeyFile.DEFAULT_CONFIG` is writable from app code during
implementation; if the SDK's typings don't expose it, access via a narrowly-scoped
cast confined to this file.

### `Wallet` type (`src/types`)

Add `kdfVersion?: number`. Absent ⇒ legacy (V1).

### `src/core/wallet-service.ts`

- **`saveWallet`** (used by both create and import): wrap the
  `keyFile.encrypt(keyStore)` call in `withKdfParams(KDF_PARAMS_V2, …)` and set
  `wallet.kdfVersion = CURRENT_KDF_VERSION`.
- **`unlockWallet`**: look up the wallet, then decrypt inside
  `withKdfParams(kdfParamsForVersion(wallet.kdfVersion), …)`. Keep the existing
  failed-attempt throttling and the `delete(address)` on success. On a successful
  decrypt, if `(wallet.kdfVersion ?? 1) < CURRENT_KDF_VERSION`, **upgrade on
  unlock**:
  - re-encrypt the just-decrypted `keyStore` inside `withKdfParams(KDF_PARAMS_V2, …)`,
  - overwrite `wallet.encryptedKeyFile`, set `wallet.kdfVersion = CURRENT_KDF_VERSION`,
  - persist via `storage.set`.
  - Wrap the upgrade in its own try/catch: a re-encrypt/persist failure is logged
    and swallowed — it must never block the unlock or lose the session.
- The `sessionManager.unlock(...)` call happens regardless of upgrade outcome.

### Migration behavior

An existing wallet has no `kdfVersion` → treated as V1 → decrypts at `timeCost: 1`
→ on success re-encrypts to V2 and records `kdfVersion: 2`. The next unlock uses
V2. New/imported wallets are V2 from creation. The SDK keyfile's own
`version: 1`/format field is independent and untouched.

---

## Data flow

```
Create/Import:  estimatePasswordStrength → meetsFloor gate
                → withKdfParams(V2){ keyFile.encrypt } → store { …, kdfVersion: 2 }

Unlock:         withKdfParams(paramsFor(wallet.kdfVersion)){ keyFile.decrypt }
                ├ fail → throttle counter++, "Invalid password"
                └ ok   → clear counter, sessionManager.unlock
                         └ if legacy → best-effort: withKdfParams(V2){ re-encrypt }
                                       → store { encryptedKeyFile, kdfVersion: 2 }
```

## Files touched

- New: `src/core/password-strength.ts`, `src/components/PasswordStrengthMeter.vue`,
  `src/core/kdf.ts`
- Modified: `src/config.ts`, `src/components/CreateWalletForm.vue`,
  `src/components/ImportWalletForm.vue`, `src/types` (the `Wallet` interface),
  `src/core/wallet-service.ts`

## Testing & verification

No automated suite (per `CLAUDE.md`). Gates: `npm run typecheck` (no NEW errors
beyond the pre-existing baseline), `npm run lint` (0 errors), `npm run build`.
Manual:

1. **Create:** weak passwords (short / single-pool) are rejected with a live meter;
   a 12+ mixed password is accepted. New wallet stores `kdfVersion: 2`; lock then
   unlock succeeds.
2. **Import:** same floor + meter; imported wallet is V2.
3. **Legacy upgrade:** simulate a pre-existing wallet (encrypt at V1 / no
   `kdfVersion`), unlock once → verify it still unlocks, then verify storage now
   shows `kdfVersion: 2` and a subsequent unlock works.
4. **Wrong password** still increments throttling and shows "Invalid password".
5. **Unlock latency:** measure decrypt time at `KDF_PARAMS_V2` in the browser; tune
   `timeCost` (and/or `memoryCost`) so unlock stays under ~1.5s on typical
   hardware. A visible spinner already covers the unlock state.

## Open risks

- `withKdfParams` mutates an undocumented SDK static; an SDK update could change
  `DEFAULT_CONFIG`'s shape/name. Mitigation: it's isolated to `kdf.ts`, and
  `KDF_PARAMS_V1` must be kept in lockstep with the SDK's historical default so
  legacy decrypts keep working.
- argon2-browser performance at higher `timeCost`/memory is hardware-dependent;
  the V2 params are a starting target to be tuned against the latency budget.

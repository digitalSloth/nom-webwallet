# plasma.bot Contextual Prompt — Design Spec (UX revision)

**Date:** 2026-06-04
**Branch:** `feat/plasma-bot-integration`
**Status:** Approved design, ready for implementation planning
**Supersedes the UI portion of:** `2026-06-03-plasma-bot-integration-design.md`

## Summary

Dev feedback on the first cut: the always-visible two-column Plasma tab (self-fuse
left, plasma.bot faucet right) surfaces plasma.bot too prominently, and burying it
in Settings would make it too hidden. Instead, surface plasma.bot **contextually** —
only when the user actually needs it — via a button above the Plasma form that opens
a dialog.

This is a **presentation-only** change. The service, composable, config constants,
and extension manifest from the original integration are reused unchanged. The
two-column layout is reverted to the single self-fuse form; the plasma.bot tier
selector, request logic, and error→toast mapping move into a new dialog component.

## Goals

- Offer free plasma exactly when the user is stuck: no plasma AND too little QSR to
  self-fuse.
- Keep the existing self-fuse form and active-fusions list unchanged.
- Preserve the three plasma.bot tiers (Low 20 / Medium 80 / High 120 QSR) inside the
  dialog.

## Non-Goals (YAGNI)

- No always-visible faucet column (removed).
- No plasma.bot entry point in Settings.
- No changes to `config.ts`, `plasma-bot-service.ts`, `usePlasmaBot.ts`, or
  `manifest.json` — they are reused as-is.

## Trigger condition

The "get free plasma" button is shown on the Plasma tab only when BOTH hold for the
active account:

- `currentPlasma === 0`, AND
- `qsrBalance < MIN_FUSE_AMOUNT_QSR` (10 QSR — already defined in `src/config.ts`).

Rationale: if the user has ≥ 10 QSR they can self-fuse with the existing form, so no
nudge is needed. The button appears only when they can neither transact (0 plasma)
nor self-fuse (< 10 QSR). It auto-hides as soon as either condition stops holding
(e.g. after a successful bot request raises plasma above 0).

`qsrBalance` is exposed by `useAccount` as a string computed; compare via
`parseFloat(account.qsrBalance.value) < MIN_FUSE_AMOUNT_QSR`. `currentPlasma` is
exposed by `useAccount` as a number but is currently NOT loaded by the Plasma tab —
`loadData()` must additionally call `account.loadPlasmaInfo()`.

## Components

### New: `src/components/PlasmaBotDialog.vue`

A self-contained, controlled dialog (follows the repo's `open` prop + `update:open`
emit pattern, as in `SettingsDialog.vue`). Built from `@nom/ui` Dialog primitives
(`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
`DialogFooter`).

- **Props:** `open: boolean`, `activeAccountAddress: string | null`
- **Emits:** `update:open` (controlled open state), `showToast` (forwarded up to the
  app toast system), `fused` (a bot fusion succeeded)
- **Content:**
  - A short blurb: plasma.bot fuses QSR to your account for free — no QSR and no
    wallet unlock required.
  - The **3-tier selector** (`PLASMA_BOT_TIERS`): Low 20 / Medium 80 / High 120,
    rendered as Buttons (selected → `default` variant, others → `outline`); default
    selection `low`.
  - A locked, read-only beneficiary display bound to `activeAccountAddress`.
  - A **Get Plasma** button (disabled while `usePlasmaBot().isFusing` or no account).
- **Behavior (moved from the old PlasmaTab right column):**
  - `handleRequest()` calls `usePlasmaBot().fuse(activeAccountAddress, selectedTier)`.
  - On success: emit `showToast('plasma.bot fused {qsr} QSR to your account!',
    'success')`, emit `fused`, then close (`emit('update:open', false)`).
  - On `PlasmaBotError`: emit `showToast` with the mapped friendly message; the
    dialog STAYS OPEN so the user can retry (e.g. pick a lower tier).
  - Error→toast mapping (unchanged from original):
    | code | message / type |
    |---|---|
    | `ADDRESS_UNAVAILABLE` | "You already have an active plasma.bot fusion for this account." / warning |
    | `RATE_LIMITED` | "plasma.bot rate limit reached — please try again later." / warning |
    | `INSUFFICIENT_BALANCE` | "plasma.bot is low on QSR right now. Try a lower tier or try again later." / warning |
    | `VALIDATION_FAILED` | "Could not request plasma: invalid request." / error |
    | default | "Failed to get plasma from plasma.bot. Please try again." / error |

### Modified: `src/components/PlasmaTab.vue`

- Revert the two-column grid back to the single self-fuse form. Remove the
  plasma.bot right `<section>`, the tier-selector state (`selectedBotTier`,
  `botTiers`), `handleBotFuse`, and `botErrorToToast` (these move into the dialog).
  The self-fuse form and the "Active Plasma Fusions" list are otherwise unchanged.
- Add local state `const botDialogOpen = ref(false)`.
- Add a computed gate:
  `const showBotPrompt = computed(() => account.currentPlasma.value === 0 &&
  parseFloat(account.qsrBalance.value) < MIN_FUSE_AMOUNT_QSR)`.
- Above the self-fuse form, render `v-if="showBotPrompt"` a prompt row: a brief
  message ("No plasma yet — get some free from plasma.bot") and a button that sets
  `botDialogOpen = true`.
- Render `<PlasmaBotDialog v-model:open="botDialogOpen"
  :active-account-address="activeAccountAddress" @show-toast="(m, t) =>
  emit('showToast', m, t)" @fused="onBotFused" />`.
- `onBotFused()` → `await loadData()` then `emit('plasmaUpdated')`. Because
  `loadData()` now also loads plasma info, a successful request raises
  `currentPlasma` above 0 and the prompt auto-hides.
- `loadData()` adds `account.loadPlasmaInfo()` to its `Promise.all`.

## Data flow

```
PlasmaTab loadData() → loads balances + plasma info → showBotPrompt computed
  (currentPlasma === 0 && qsrBalance < 10) ? show "Get free plasma" button
    → click → botDialogOpen = true → <PlasmaBotDialog>
      → pick tier → Get Plasma → usePlasmaBot().fuse(account, tier)
        → success → showToast + emit fused + close dialog
            → PlasmaTab.onBotFused → loadData() (plasma > 0 → prompt hides) + plasmaUpdated
        → error → mapped showToast, dialog stays open
```

## Files touched

- `src/components/PlasmaBotDialog.vue` — **create**.
- `src/components/PlasmaTab.vue` — **modify** (revert two-column; add prompt + dialog
  + plasma-info load).

Unchanged / reused: `src/config.ts`, `src/core/plasma-bot-service.ts`,
`src/core/composables/usePlasmaBot.ts`, `src/core/composables/index.ts` (the
`@/core` re-exports of `PlasmaBotError`/`PlasmaBotTierKey` are now consumed by the
dialog instead of PlasmaTab), `manifest.json`.

## Testing & verification

No automated suite (per `CLAUDE.md`). Gates: `npm run typecheck` (no NEW errors
beyond the ~11 pre-existing), `npm run lint` (0 errors), `npm run build`. Manual:

1. Account with 0 plasma and < 10 QSR → prompt button visible → dialog → pick each
   tier → request → success toast, dialog closes, prompt disappears (plasma > 0).
2. Account with ≥ 10 QSR and 0 plasma → prompt NOT shown (can self-fuse instead).
3. Account with plasma > 0 → prompt NOT shown.
4. Error path (request twice) → `ADDRESS_UNAVAILABLE` warning toast, dialog stays
   open.
5. Self-fuse form and active-fusions list unchanged.

## Open risks

- Same external dependency as before: the plasma.bot server CORS change (separate
  repo PR, prepared) is required for the web-app request to succeed; the extension
  uses `host_permissions`.

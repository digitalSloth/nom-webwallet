# plazma.bot Availability Check — Design Spec

**Date:** 2026-06-04
**Branch:** `feat/plasma-bot-integration`
**Status:** Approved design, ready for implementation planning
**Builds on:** `2026-06-04-plasma-bot-contextual-prompt-design.md`

## Summary

When the plazma.bot request dialog opens, check the bot's live status so the user
only sees fundable options instead of clicking **Get Plasma** and hitting an
`INSUFFICIENT_BALANCE` error after the fact. The dialog fetches the bot's public
`GET /api/stats`, shows a status line, disables tiers the bot can't currently fund,
and auto-selects a fundable tier.

The check is **fail-open**: if `/api/stats` can't be reached (network/CORS/timeout),
the dialog leaves all tiers enabled and lets the actual fuse call surface any real
error — a flaky stats endpoint never blocks a fuse that would otherwise work.

## Goals

- Reflect real bot availability (up/down and per-tier funding) before the user
  commits to a request.
- Show a short, human status line in the dialog.
- Never block a request just because the availability check failed.

## Non-Goals (YAGNI)

- No polling/auto-refresh — fetch once per dialog open.
- No use of `GET /api/health` (the `/api/stats` `availableTiers` field already
  covers liveness + per-tier funding).
- No changes to the `fuse()` request flow, `config.ts`, `manifest.json`, or
  `PlasmaTab.vue`.

## Background: the `/api/stats` endpoint

Public GET endpoint (rate-limited 100/min/IP, 5s server-side cache). Relevant
fields of the 200 response:

```json
{
  "walletAddress": "z1...",
  "qsrAvailable": 1234,
  "qsrFused": 5678,
  "qsrBalance": 1234,
  "activeFusionCount": 42,
  "availableTiers": ["low", "medium", "high"],
  "nextUnfuseAt": "2026-06-04T...Z",
  "currentHeight": 12345678
}
```

`availableTiers` is computed server-side as "current balance ≥ that tier's QSR
cost," giving a direct per-tier "can fund now" signal. The dialog consumes
`availableTiers` and `qsrAvailable` (plus `activeFusionCount` for potential future
use); other fields are ignored.

## CORS (extends the pending plazma.bot PR)

`/api/stats` sits under the bot's global CORS lock (`origin: FRONTEND_URL`), so the
browser can't call it cross-origin yet. The pending plazma.bot PR (which already
opens `/api/agent`) gains a second scoped handler, registered BEFORE the global
locked CORS in `backend/src/middleware/security.ts`:

```ts
app.use('/api/stats', cors({ origin: '*', methods: ['GET'], allowedHeaders: ['Content-Type'] }))
```

All other endpoints remain locked to `FRONTEND_URL`.

> The web-app availability check is only functional once this is deployed. Until
> then `/api/stats` fails CORS → the dialog treats the bot as `unreachable` and
> (fail-open) leaves all tiers enabled, exactly as designed.

## Wallet-side design

### Service — `src/core/plasma-bot-service.ts`

Add a typed stats shape and a `getStats()` method. `fuse()` is unchanged.

```ts
export interface PlasmaBotStats {
  qsrAvailable: number
  availableTiers: PlasmaBotTierKey[]
  activeFusionCount: number
}
```

`getStats()` behavior:
- `GET ${baseUrl}/api/stats`.
- On a 200 JSON body, return a `PlasmaBotStats` built from `qsrAvailable`,
  `availableTiers` (filtered to known tier keys), and `activeFusionCount` (with
  safe numeric defaults).
- On fetch failure, non-2xx, or non-JSON, throw `PlasmaBotError('NETWORK_ERROR',
  ...)` — consistent with `fuse()`'s failure contract.

### Composable — `src/core/composables/usePlasmaBot.ts`

Add module-level reactive state (matching the existing shared-state pattern) and a
loader. `fuse()` and its state are unchanged.

- `stats: Ref<PlasmaBotStats | null>` — last successful stats; `null` when unknown.
- `statsStatus: Ref<'idle' | 'checking' | 'online' | 'unreachable'>`
- `loadStats(): Promise<void>`:
  - set `statsStatus = 'checking'`
  - on success: `stats = result`, `statsStatus = 'online'`
  - on any error: `stats = null`, `statsStatus = 'unreachable'` — **does NOT throw**
    (fail-open). The error is swallowed (optionally `console.error`'d).

Both new refs are returned alongside the existing `{ isFusing, lastResult, error,
fuse }`.

### Dialog — `src/components/PlasmaBotDialog.vue`

**Trigger the check on open.** `watch` the `open` prop; when it transitions to
`true`, call `plasmaBot.loadStats()`. (Do not fetch while closed.)

**Status line** (rendered under the existing blurb):

| `statsStatus` | text | tone |
|---|---|---|
| `checking` | "Checking plazma.bot…" | muted |
| `online`, `availableTiers` non-empty | "plazma.bot online · {qsrAvailable} QSR available" | muted/normal |
| `online`, `availableTiers` empty | "plazma.bot is low on QSR right now." | warning |
| `unreachable` | "Couldn't reach plazma.bot — you can still try." | muted |
| `idle` | (no line) | — |

**Per-tier enable/disable.** A tier button is disabled when:
`plasmaBot.isFusing.value` OR (`statsStatus === 'online'` AND `tier.key` not in
`stats.availableTiers`). While `checking` or `unreachable`, tiers are NOT disabled
by availability (fail-open) — only by `isFusing`.

**Auto-select a fundable tier.** After a successful `loadStats()`, if the currently
`selectedTier` is not in `availableTiers`, set `selectedTier` to the first
(lowest, by `PLASMA_BOT_TIERS` order) tier that IS available. If none are
available, leave the selection as-is (all tiers are disabled anyway and the request
button is disabled).

**Get Plasma button.** Disabled when: `plasmaBot.isFusing.value`, no
`activeAccountAddress`, OR (`statsStatus === 'online'` AND `availableTiers` is
empty). When `unreachable`/`checking`, it stays enabled (fail-open), subject to the
account/isFusing checks.

**`handleRequest()` is unchanged** — same `fuse()` call, success/error handling, and
close-on-success behavior from the prior increment.

## Data flow

```
dialog open prop → true → loadStats() → GET /api/stats
  ├ 200 → statsStatus = online, stats set
  │        → status line + per-tier enable/disable + auto-select lowest available
  │        → if availableTiers empty: warning line, all tiers + Get Plasma disabled
  └ fail → statsStatus = unreachable, stats = null
           → "couldn't reach…" line, all tiers enabled (fail-open), Get Plasma enabled
click Get Plasma → existing fuse() flow (unchanged)
```

## Files touched

**wallet repo:**
- `src/core/plasma-bot-service.ts` — add `PlasmaBotStats` + `getStats()`.
- `src/core/composables/usePlasmaBot.ts` — add `stats`, `statsStatus`, `loadStats()`.
- `src/components/PlasmaBotDialog.vue` — on-open check, status line, per-tier
  disable, auto-select, Get Plasma disable rule.

**plazma.bot repo (extends the pending CORS PR):**
- `backend/src/middleware/security.ts` — add scoped GET CORS for `/api/stats`.

Unchanged: `config.ts`, `manifest.json`, `PlasmaTab.vue`, the `fuse()` flow.

## Testing & verification

No automated suite (per `CLAUDE.md`). Gates: `npm run typecheck` (no NEW errors
beyond the pre-existing baseline), `npm run lint` (0 errors), `npm run build`.
Manual (after the CORS change is deployed, or by temporarily pointing at a reachable
stats endpoint):

1. Bot online, all tiers funded → status line shows "online · N QSR available", all
   tiers enabled, Get Plasma enabled.
2. Bot online, only `low` funded (simulate) → Medium/High disabled, selection
   auto-moves to Low if it had been on a disabled tier.
3. Bot online, no tiers funded → "low on QSR" warning, all tiers + Get Plasma
   disabled.
4. Stats unreachable (e.g. before CORS deploy) → "couldn't reach…" line, all tiers
   enabled, Get Plasma enabled (fail-open); a click then surfaces the real fuse
   error.
5. Re-opening the dialog re-runs the check (status reflects current state).

## Open risks

- The status line and per-tier gating are only meaningful once the `/api/stats`
  CORS scope is deployed; before that, every web-app open shows `unreachable`
  (fail-open keeps the dialog usable). The extension path depends on the same
  server sending permissive CORS headers for `/api/stats`.
- `/api/stats` is cached 5s server-side; a tier could in rare cases flip between the
  check and the fuse — handled gracefully by the existing `INSUFFICIENT_BALANCE`
  toast on the fuse call.

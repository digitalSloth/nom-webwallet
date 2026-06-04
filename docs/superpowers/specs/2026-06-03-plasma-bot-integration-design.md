# plasma.bot Integration — Design Spec

**Date:** 2026-06-03
**Branch:** `feat/plasma-bot-integration`
**Status:** Approved design, ready for implementation planning

## Summary

Add a second way to obtain plasma in the wallet's Plasma tab: requesting **free
plasma from [plasma.bot](https://github.com/0x3639/plasma.bot)** via its public
agent API, alongside the existing self-funded fusion.

Today the Plasma tab (`src/components/PlasmaTab.vue`) only lets a user fuse QSR
**from their own wallet** — this costs their QSR, locks for 10h, and produces a
cancelable fusion. That is useless to a brand-new account with `0 QSR` (the exact
case in the original screenshot). plasma.bot solves this: the bot fuses **its
own** QSR to the user's address for free.

The tab is reworked into two columns:

- **Left — "Fuse from your wallet"**: the existing flow, unchanged.
- **Right — "Get free plasma from plasma.bot"**: pick a tier, click once, the bot
  fuses plasma to the current account. No QSR and no wallet unlock required.

## Goals

- Let a user with 0 QSR get usable plasma in one click.
- Offer the same three tiers plasma.bot exposes: **Low 20 / Medium 80 / High 120 QSR**.
- Work in both build targets (web app and Chrome MV3 extension).
- Reuse the existing service → composable → component pattern; no direct service
  imports from components.

## Non-Goals (YAGNI)

- Polling/displaying bot-owned fusion status over time (bot fusions are owned and
  auto-managed FIFO by the bot; the user cannot cancel them).
- Showing the bot's public stats banner (balance, total fused, tiers available).
- Telegram or web-form flows — agent API only.
- Gifting free plasma to an arbitrary address (the bot column is locked to the
  current account; the left/self-funded column keeps its editable beneficiary).

## Background: the plasma.bot agent API

Public, machine-readable API meant for bots/scripts/agents.

- **Endpoint:** `POST {base}/api/agent/fuse`
- **Request:** `Content-Type: application/json`, body `{ "address": "z1...", "tier": "low" | "medium" | "high" }`
- **Tiers:** `low` = 20 QSR, `medium` = 80 QSR, `high` = 120 QSR.
- **Success (200):** `{ "success": true, "txHash": "...", "address": "z1...", "tier": "low", "amount": 20 }`
- **Errors:** `{ "success": false, "error": { "code": "...", "message": "..." } }`
  - `VALIDATION_FAILED` (400)
  - `RATE_LIMITED` (429) — 10 requests / IP / 24h
  - `ADDRESS_UNAVAILABLE` (429) — the address already has one active fusion
  - `INSUFFICIENT_BALANCE` (503) — bot is low on QSR (includes `available`, `needed`, `nextUnfuseAt`)
  - `FUSE_FAILED` (500)
  - `UNSUPPORTED_MEDIA_TYPE` (415) — missing `application/json`

The bot signs and pays; the wallet never touches a private key for this flow, so
it works with a **locked wallet and 0 QSR**.

## Cross-cutting constraint: CORS (two-repo change)

The bot backend currently applies a single global CORS policy locked to its own
frontend origin (`cors({ origin: CONFIG.FRONTEND_URL })` in
`backend/src/middleware/security.ts`). A browser calling the agent API from the
wallet's origin (web app at `localhost:5173` / hosted domain, or the extension
origin) is blocked at the CORS preflight.

**Resolution (approved):** since the same owner controls both repos, relax CORS
**on the agent route only** — it is already a public, machine-readable endpoint
(it serves `llms.txt` and `openapi.json` publicly).

### plasma.bot change (separate commit/PR)

Mount a permissive CORS handler scoped to `/api/agent` *before* the global locked
CORS in `setupSecurity` (or where the agent router is mounted):

```ts
app.use('/api/agent', cors({ origin: '*', methods: ['POST'], allowedHeaders: ['Content-Type'] }))
```

This leaves all other endpoints (`/api/fuse`, `/api/stats`, admin, etc.) locked to
`FRONTEND_URL`. Only the agent fuse path becomes cross-origin callable, matching
its documented "for bots, scripts, and AI agents" purpose.

> Implementation note: this spec's wallet-side work assumes the CORS change is
> deployed. Until then the web app's bot column will fail at the preflight; the
> extension build works regardless via host permissions (below).

## Wallet-side design

### Config (`src/config.ts`)

```ts
// --- plasma.bot (free plasma faucet) ---
/** Base URL of the plasma.bot agent API. */
export const PLASMA_BOT_API_URL = 'https://plazma.bot'

export interface PlasmaBotTier {
  key: 'low' | 'medium' | 'high'
  label: string
  /** QSR the bot fuses for this tier. */
  qsr: number
}

export const PLASMA_BOT_TIERS: readonly PlasmaBotTier[] = [
  { key: 'low', label: 'Low', qsr: 20 },
  { key: 'medium', label: 'Medium', qsr: 80 },
  { key: 'high', label: 'High', qsr: 120 },
] as const
```

### Service (`src/core/plasma-bot-service.ts`)

A plain REST client. **Not** a `getInstance()` singleton tied to `ZenonService`
(it talks HTTP to the bot, not the chain). Single responsibility: turn a
`(address, tier)` request into a typed result or a typed error.

```ts
export type PlasmaBotTierKey = 'low' | 'medium' | 'high'

export interface PlasmaBotFuseSuccess {
  txHash: string
  address: string
  tier: PlasmaBotTierKey
  amount: number
}

export type PlasmaBotErrorCode =
  | 'VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'ADDRESS_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'FUSE_FAILED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'NETWORK_ERROR'   // synthesized client-side for fetch/JSON failures

export class PlasmaBotError extends Error {
  constructor(public code: PlasmaBotErrorCode, message: string) { super(message) }
}

export class PlasmaBotService {
  // baseUrl defaults to PLASMA_BOT_API_URL; injectable for testing
  async fuse(address: string, tier: PlasmaBotTierKey): Promise<PlasmaBotFuseSuccess>
}
```

`fuse()` behavior:
- `POST ${baseUrl}/api/agent/fuse` with JSON body and `Content-Type: application/json`.
- On `success: true`, return the typed success object.
- On any non-success (HTTP error body, thrown fetch, non-JSON), throw a
  `PlasmaBotError` carrying the bot's `error.code` (or `NETWORK_ERROR`).

### Composable (`src/core/composables/usePlasmaBot.ts`)

Reactive wrapper, exported through `src/core/composables/index.ts` (so it flows out
of `@/core` like the others). State:

- `isFusing: Ref<boolean>`
- `lastResult: Ref<PlasmaBotFuseSuccess | null>`
- `error: Ref<PlasmaBotError | null>`
- `fuse(address, tier): Promise<PlasmaBotFuseSuccess>` — flips `isFusing`, stores
  result/error, rethrows so the component can toast.

### Component changes (`src/components/PlasmaTab.vue`)

Restructure the form region into a responsive two-column grid; the active-fusions
list stays full-width beneath it.

```
<div class="grid gap-6 md:grid-cols-2">
  <section> … left: existing self-fuse form … </section>
  <section> … right: plasma.bot panel … </section>
</div>
<div> … existing "Active Plasma Fusions" list (full width) … </div>
```

- **Left column** — the current self-fuse form moved verbatim (editable
  beneficiary, amount, balance hint, `Fuse Plasma`), under a heading like
  **"Fuse from your wallet"**.
- **Right column** — heading **"Get free plasma from plasma.bot"**, helper copy
  that it is free and goes to the current account:
  - Read-only display of the current account address (the beneficiary; locked).
  - Three tier options (`PLASMA_BOT_TIERS`) rendered as selectable buttons /
    segmented control showing label + `{qsr} QSR`; default selection `low`.
  - A **Get Plasma** button, disabled while `usePlasmaBot.isFusing`.
  - If there is no active account, disable the panel with a hint.

On click:
1. `await plasmaBot.fuse(activeAccountAddress, selectedTier)`.
2. Success → `emit('showToast', 'plasma.bot fused {qsr} QSR to your account!', 'success')`,
   then refresh balances/plasma so the user sees it arrive:
   `account.loadBalances()` + reload plasma/account state (reuse the tab's existing
   `loadData()` refresh path). Also `emit('plasmaUpdated')`.
3. Error → map code to a friendly toast (table below).

Note the bot column does **not** require `wallet.isActiveWalletUnlocked` — unlike
the left column — because no local signing happens.

### Error → message mapping

| `PlasmaBotErrorCode` | Toast (type) |
|---|---|
| `ADDRESS_UNAVAILABLE` | "You already have an active plasma.bot fusion for this account." (warning) |
| `RATE_LIMITED` | "plasma.bot rate limit reached — please try again later." (warning) |
| `INSUFFICIENT_BALANCE` | "plasma.bot is low on QSR right now. Try a lower tier or try again later." (warning) |
| `VALIDATION_FAILED` | "Could not request plasma: invalid request." (error) |
| `UNSUPPORTED_MEDIA_TYPE` / `FUSE_FAILED` / `NETWORK_ERROR` | "Failed to get plasma from plasma.bot. Please try again." (error) |

### Extension manifest (`manifest.json`)

MV3 fetches from the wallet's origin are subject to CORS; the bot-side CORS change
covers this, but to be robust across extension contexts add the host permission:

```json
"host_permissions": ["https://plazma.bot/*"]
```

(Confirm against the existing `manifest.json` shape during implementation;
`node.zenonhub.io` websocket access already implies network use.)

## Data flow

```
User clicks "Get Plasma" (tier)
  → usePlasmaBot.fuse(currentAccount, tier)
    → PlasmaBotService.fuse()  POST https://plazma.bot/api/agent/fuse {address, tier}
      → 200 success  → toast + refresh account plasma/QSR balances
      → error code   → mapped friendly toast
```

No private key, no QSR spent, no wallet unlock. Bot-owned fusions do not appear in
the user's own "Active Plasma Fusions" list (those are queried by the user's
address as the *funder*), which is correct — the user cannot cancel them.

## Files touched

**wallet repo (`feat/plasma-bot-integration`):**
- `src/config.ts` — add `PLASMA_BOT_API_URL`, `PLASMA_BOT_TIERS`, `PlasmaBotTier`.
- `src/core/plasma-bot-service.ts` — new REST client + typed errors.
- `src/core/composables/usePlasmaBot.ts` — new composable.
- `src/core/composables/index.ts` — export `usePlasmaBot`.
- `src/components/PlasmaTab.vue` — two-column refactor + bot panel.
- `manifest.json` — add `host_permissions` for `https://plazma.bot/*`.

**plasma.bot repo (separate change):**
- `backend/src/middleware/security.ts` (or agent router mount) — scoped permissive
  CORS for `/api/agent`.

## Testing & verification

No automated suite (per `CLAUDE.md`); correctness via TypeScript strict mode plus
manual verification:

1. `npm run lint` and a clean `npm run build` / `npm run build:extension`.
2. Web app: new account with 0 QSR → right column → each tier → plasma arrives;
   verify success toast and balances refresh.
3. Trigger and confirm the friendly mapping for `ADDRESS_UNAVAILABLE` (request
   twice) and at least one other error path.
4. Extension build: same happy path through the popup, confirming the responsive
   layout stacks to one column.
5. Confirm the left/self-fuse column and the active-fusions list are unchanged.

## Open risks

- Relies on the plasma.bot CORS change being deployed before the web app's bot
  column is functional; the extension build degrades gracefully via host
  permissions but still needs the server to send permissive CORS headers.
- Domain spelling is `plazma.bot` (with a z) per the bot README's curl examples;
  centralized in `PLASMA_BOT_API_URL` so it is trivial to correct.

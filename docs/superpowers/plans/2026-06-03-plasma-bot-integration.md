# plasma.bot Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "get free plasma from plasma.bot" column to the wallet's Plasma tab, backed by the plasma.bot agent API, alongside the existing self-funded fusion.

**Architecture:** A plain REST client service (`PlasmaBotService`) wrapped by a reactive composable (`usePlasmaBot`), consumed by a refactored two-column `PlasmaTab.vue`. The bot signs and pays, so the flow needs no wallet unlock and no user QSR. A separate, scoped CORS change on the plasma.bot repo makes the agent endpoint cross-origin callable.

**Tech Stack:** Vue 3 Composition API, TypeScript (strict), Vite, Tailwind CSS 4, `@nom/ui` (shadcn-vue). No automated test suite — correctness is verified via `tsc` (strict), ESLint, and production builds, per `CLAUDE.md`.

**Spec:** `docs/superpowers/specs/2026-06-03-plasma-bot-integration-design.md`

**Branch:** `feat/plasma-bot-integration` (already created)

---

## Verification model (read first)

This repo has **no unit tests**. The TDD "write failing test" step is replaced by **typecheck + lint + build** gates and explicit manual checks. The commands used as gates throughout:

- Typecheck: `npx vue-tsc --noEmit` (falls back to `npx tsc --noEmit` if `vue-tsc` is unavailable — confirm which exists in `package.json` scripts during Task 1).
- Lint: `npm run lint`
- Web build: `npm run build`
- Extension build: `npm run build:extension`

Each task ends by running the relevant gate and committing only when it passes. Never claim a gate passed without running it.

---

## File Structure

**wallet repo (`feat/plasma-bot-integration`):**
- `src/config.ts` — *modify*: add `PLASMA_BOT_API_URL`, `PlasmaBotTier`, `PLASMA_BOT_TIERS`.
- `src/core/plasma-bot-service.ts` — *create*: REST client + typed error.
- `src/core/composables/usePlasmaBot.ts` — *create*: reactive wrapper.
- `src/core/composables/index.ts` — *modify*: export `usePlasmaBot` + types.
- `src/components/PlasmaTab.vue` — *modify*: two-column refactor + bot panel.
- `manifest.json` — *modify*: add `host_permissions`.

**plasma.bot repo (separate clone/PR, not this branch):**
- `backend/src/middleware/security.ts` — *modify*: scoped permissive CORS for `/api/agent`.

---

## Task 1: Confirm tooling gates

**Files:**
- Read: `package.json`

- [ ] **Step 1: Inspect the scripts block**

Run: `cat package.json`
Identify the exact commands behind `lint`, `build`, `build:extension`, and whether a typecheck script (`vue-tsc`/`tsc`) exists. Note the real typecheck command for use in later tasks (the plan assumes `npx vue-tsc --noEmit`).

- [ ] **Step 2: Establish a clean baseline**

Run, in order:
```bash
npx vue-tsc --noEmit
npm run lint
```
Expected: both pass with no errors on the untouched branch. If the baseline is already failing, stop and report — do not build on a red baseline.

No commit (read-only task).

---

## Task 2: Add config constants

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Append the plasma.bot config block**

Add to the end of `src/config.ts`:

```ts
// --- plasma.bot (free plasma faucet) ---
/** Base URL of the plasma.bot agent API (note: domain is spelled "plazma"). */
export const PLASMA_BOT_API_URL = 'https://plazma.bot'

export interface PlasmaBotTier {
  key: 'low' | 'medium' | 'high'
  label: string
  /** QSR the bot fuses for this tier. */
  qsr: number
}

/** Tiers offered by plasma.bot, matching its agent API. */
export const PLASMA_BOT_TIERS: readonly PlasmaBotTier[] = [
  { key: 'low', label: 'Low', qsr: 20 },
  { key: 'medium', label: 'Medium', qsr: 80 },
  { key: 'high', label: 'High', qsr: 120 }
] as const
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: PASS (no unused-export errors — exports are unused until Task 3/5, which is fine).

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: add plasma.bot config constants"
```

---

## Task 3: Create the PlasmaBotService REST client

**Files:**
- Create: `src/core/plasma-bot-service.ts`

- [ ] **Step 1: Write the service**

Create `src/core/plasma-bot-service.ts`:

```ts
import { PLASMA_BOT_API_URL } from '@/config'

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
  | 'NETWORK_ERROR'

const KNOWN_CODES: readonly PlasmaBotErrorCode[] = [
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'ADDRESS_UNAVAILABLE',
  'INSUFFICIENT_BALANCE',
  'FUSE_FAILED',
  'UNSUPPORTED_MEDIA_TYPE',
  'NETWORK_ERROR'
]

export class PlasmaBotError extends Error {
  constructor(
    public code: PlasmaBotErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PlasmaBotError'
  }
}

/**
 * REST client for the plasma.bot agent API. Talks plain HTTP to the bot (not the
 * chain), so it is a normal class, not a ZenonService-style singleton.
 */
export class PlasmaBotService {
  constructor(private baseUrl: string = PLASMA_BOT_API_URL) {}

  /** Request a free plasma fusion from the bot to `address`. */
  async fuse(address: string, tier: PlasmaBotTierKey): Promise<PlasmaBotFuseSuccess> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/agent/fuse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, tier })
      })
    } catch (err) {
      throw new PlasmaBotError(
        'NETWORK_ERROR',
        err instanceof Error ? err.message : 'Network request failed'
      )
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new PlasmaBotError('NETWORK_ERROR', 'Invalid response from plasma.bot')
    }

    const data = body as {
      success?: boolean
      txHash?: string
      amount?: number
      error?: { code?: string; message?: string }
    }

    if (response.ok && data.success === true) {
      return {
        txHash: data.txHash ?? '',
        address,
        tier,
        amount: data.amount ?? 0
      }
    }

    const rawCode = data.error?.code
    const code: PlasmaBotErrorCode = KNOWN_CODES.includes(rawCode as PlasmaBotErrorCode)
      ? (rawCode as PlasmaBotErrorCode)
      : 'FUSE_FAILED'
    throw new PlasmaBotError(code, data.error?.message ?? 'plasma.bot request failed')
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/plasma-bot-service.ts
git commit -m "feat: add PlasmaBotService REST client"
```

---

## Task 4: Create the usePlasmaBot composable

**Files:**
- Create: `src/core/composables/usePlasmaBot.ts`
- Modify: `src/core/composables/index.ts`

Follows the existing composable convention (module-level shared reactive state + `export function useX()`), matching `usePlasma.ts`.

- [ ] **Step 1: Write the composable**

Create `src/core/composables/usePlasmaBot.ts`:

```ts
import { ref } from 'vue'
import {
  PlasmaBotService,
  PlasmaBotError,
  type PlasmaBotTierKey,
  type PlasmaBotFuseSuccess
} from '../plasma-bot-service'

// Module-level reactive state — shared across every usePlasmaBot() caller
const isFusing = ref(false)
const lastResult = ref<PlasmaBotFuseSuccess | null>(null)
const error = ref<PlasmaBotError | null>(null)

const service = new PlasmaBotService()

export function usePlasmaBot() {
  /**
   * Request free plasma from plasma.bot for `address` at `tier`.
   * Throws PlasmaBotError on failure (caller maps the code to a toast).
   */
  async function fuse(
    address: string,
    tier: PlasmaBotTierKey
  ): Promise<PlasmaBotFuseSuccess> {
    isFusing.value = true
    error.value = null
    try {
      const result = await service.fuse(address, tier)
      lastResult.value = result
      return result
    } catch (err) {
      const e =
        err instanceof PlasmaBotError
          ? err
          : new PlasmaBotError('NETWORK_ERROR', 'Unexpected error')
      error.value = e
      throw e
    } finally {
      isFusing.value = false
    }
  }

  return {
    isFusing,
    lastResult,
    error,
    fuse
  }
}
```

- [ ] **Step 2: Export from the composables barrel**

In `src/core/composables/index.ts`, add after the `usePlasma` export line:

```ts
export { usePlasmaBot } from './usePlasmaBot'
```

- [ ] **Step 3: Re-export the public types from core (optional but matches pattern)**

Confirm `src/core/index.ts` re-exports composables via `export * from './composables'` (it does). Components import `usePlasmaBot` from `@/core`. The `PlasmaBotTierKey`/`PlasmaBotError` types are imported by `PlasmaTab.vue` directly from `@/core/plasma-bot-service` in Task 5 — verify that import path resolves during Task 5's typecheck.

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/composables/usePlasmaBot.ts src/core/composables/index.ts
git commit -m "feat: add usePlasmaBot composable"
```

---

## Task 5: Refactor PlasmaTab into two columns with the bot panel

**Files:**
- Modify: `src/components/PlasmaTab.vue`

This is the largest task. The existing self-fuse form and the active-fusions list are preserved verbatim; they are wrapped so the form sits in the left column of a responsive grid and a new bot panel sits on the right. The active-fusions list stays full-width below the grid.

- [ ] **Step 1: Extend the script setup**

In `src/components/PlasmaTab.vue` `<script setup>`, add imports and state.

Add to the existing import from `@/core` (it currently imports `useAccount, useNetwork, usePlasma, useWallet`) the new composable:

```ts
import {useAccount, useNetwork, usePlasma, usePlasmaBot, useWallet} from '@/core'
```

Add config + service-type imports near the existing `@/config` import:

```ts
import {MIN_FUSE_AMOUNT_QSR, PLASMA_BOT_TIERS} from '@/config'
import {PlasmaBotError, type PlasmaBotTierKey} from '@/core/plasma-bot-service'
```

After the existing `const plasma = usePlasma()` block, add:

```ts
const plasmaBot = usePlasmaBot()

// plasma.bot panel state
const selectedBotTier = ref<PlasmaBotTierKey>('low')
const botTiers = PLASMA_BOT_TIERS
```

Add the handler (place it after `handleFuse`):

```ts
function botErrorToToast(err: PlasmaBotError): {message: string; type: 'error' | 'warning'} {
  switch (err.code) {
    case 'ADDRESS_UNAVAILABLE':
      return {
        message: 'You already have an active plasma.bot fusion for this account.',
        type: 'warning'
      }
    case 'RATE_LIMITED':
      return {message: 'plasma.bot rate limit reached — please try again later.', type: 'warning'}
    case 'INSUFFICIENT_BALANCE':
      return {
        message: 'plasma.bot is low on QSR right now. Try a lower tier or try again later.',
        type: 'warning'
      }
    case 'VALIDATION_FAILED':
      return {message: 'Could not request plasma: invalid request.', type: 'error'}
    default:
      return {message: 'Failed to get plasma from plasma.bot. Please try again.', type: 'error'}
  }
}

async function handleBotFuse() {
  if (!props.activeAccountAddress) return

  const tier = botTiers.find((t) => t.key === selectedBotTier.value)
  const qsr = tier ? tier.qsr : 0

  try {
    await plasmaBot.fuse(props.activeAccountAddress, selectedBotTier.value)

    // Bot signs and pays; refresh balances so the new plasma shows up.
    await loadData()

    emit('plasmaUpdated')
    emit('showToast', `plasma.bot fused ${qsr} QSR to your account!`, 'success')
  } catch (err) {
    if (err instanceof PlasmaBotError) {
      const toast = botErrorToToast(err)
      emit('showToast', toast.message, toast.type)
    } else {
      emit('showToast', 'Failed to get plasma from plasma.bot. Please try again.', 'error')
    }
  }
}
```

- [ ] **Step 2: Restructure the template into a responsive grid**

In the `<template>`, replace the existing single `<!-- Fuse QSR Form -->` wrapper `<div class="space-y-4"> ... </div>` (the block containing beneficiary, amount, error, and Fuse button) so it becomes the **left column** of a new grid, and add the **right column** bot panel. The existing `<!-- Active Fusions List -->` block stays exactly where it is, below the grid.

Replace the form wrapper opening:

```html
      <!-- Fuse QSR Form -->
      <div class="space-y-4">
```

with:

```html
      <!-- Plasma acquisition: self-fuse (left) + plasma.bot faucet (right) -->
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Left: fuse from your own wallet -->
        <section class="space-y-4">
          <div class="font-semibold">Fuse from your wallet</div>
```

Then find the matching close of that form `<div>` (the one immediately before `<!-- Active Fusions List -->`). It currently closes the `space-y-4` form wrapper. Replace that single closing `</div>` with the close of the left `<section>`, then the entire right `<section>`, then the close of the grid `<div>`:

```html
        </section>

        <!-- Right: free plasma from plasma.bot -->
        <section class="space-y-4">
          <div class="font-semibold">Get free plasma from plasma.bot</div>
          <div class="text-xs text-muted-foreground">
            plasma.bot fuses QSR to your current account for free. No QSR or wallet
            unlock required.
          </div>

          <!-- Beneficiary (locked to current account) -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Beneficiary Address</label>
            <Input :model-value="activeAccountAddress ?? ''" disabled readonly />
            <div class="text-xs text-muted-foreground">
              Free plasma is always sent to your current account.
            </div>
          </div>

          <!-- Tier selector -->
          <div class="space-y-2">
            <label class="text-sm font-medium">Tier</label>
            <div class="grid grid-cols-3 gap-2">
              <Button
                  v-for="tier in botTiers"
                  :key="tier.key"
                  type="button"
                  :variant="selectedBotTier === tier.key ? 'default' : 'outline'"
                  :disabled="plasmaBot.isFusing.value"
                  @click="selectedBotTier = tier.key"
              >
                {{ tier.label }} · {{ tier.qsr }}
              </Button>
            </div>
            <div class="text-xs text-muted-foreground">QSR fused by the bot for the selected tier.</div>
          </div>

          <!-- Get Plasma Button -->
          <Button
              class="w-full"
              :disabled="plasmaBot.isFusing.value || !activeAccountAddress"
              @click="handleBotFuse"
          >
            {{ plasmaBot.isFusing.value ? 'Requesting…' : 'Get Plasma' }}
          </Button>
        </section>
      </div>
```

> Implementation guidance: open `PlasmaTab.vue` and make this change by hand against the real markup — the left `<section>` must wrap exactly the existing beneficiary/amount/error/Fuse-button block. Confirm `Button` and `Input` are already imported from `@nom/ui` at the top (they are). Verify `variant="outline"` and `variant="default"` are valid `Button` variants in `@nom/ui`; if not, fall back to a supported pair (e.g. `secondary`/`default`) — grep `packages/ui` for the Button variant union before finalizing.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: PASS (no semicolons, single quotes, 100-char width per `.prettierrc.json`).

- [ ] **Step 5: Web build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/PlasmaTab.vue
git commit -m "feat: add plasma.bot free-plasma column to Plasma tab"
```

---

## Task 6: Add extension host permission

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Add host_permissions**

In `manifest.json`, add a `host_permissions` key after `"permissions"`:

```json
  "permissions": ["storage"],
  "host_permissions": ["https://plazma.bot/*"],
```

- [ ] **Step 2: Extension build**

Run: `npm run build:extension`
Expected: build succeeds and the generated `dist-extension/manifest.json` includes the host permission.

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: allow plasma.bot host access in extension manifest"
```

---

## Task 7: plasma.bot repo — scoped CORS for the agent endpoint

**Files (in a separate clone of `github.com/0x3639/plasma.bot`, NOT this branch):**
- Modify: `backend/src/middleware/security.ts`

> This task lands in the plasma.bot repo as its own PR. The wallet's web-app column cannot succeed until this is deployed. Track it separately; it is documented here so the integration is complete end-to-end.

- [ ] **Step 1: Add a permissive CORS handler scoped to /api/agent**

In `backend/src/middleware/security.ts`, inside `setupSecurity(app)`, add a route-scoped CORS handler **before** the existing global `app.use(cors({ origin: CONFIG.FRONTEND_URL, ... }))`:

```ts
  // Agent API is public/machine-readable: allow any origin (POST only).
  // Must be registered BEFORE the global FRONTEND_URL-locked CORS below.
  app.use('/api/agent', cors({
    origin: '*',
    methods: ['POST'],
    allowedHeaders: ['Content-Type'],
  }));
```

- [ ] **Step 2: Verify the rest stays locked**

Confirm the existing global `app.use(cors({ origin: CONFIG.FRONTEND_URL, methods: ['GET', 'POST'] }))` still follows, so `/api/fuse`, `/api/stats`, admin, etc. remain restricted to `FRONTEND_URL`.

- [ ] **Step 3: Build/test in that repo and open a PR**

Run that repo's checks (e.g. `npm test --workspace=backend`) and open a PR titled "feat: allow cross-origin POST to /api/agent". Merge + deploy before relying on the wallet web-app column.

---

## Task 8: Manual end-to-end verification

No commit — this is the acceptance gate. Use a real account.

- [ ] **Step 1: Web app, free-plasma happy path**

Run: `npm run dev`. Open a wallet with a fresh account showing `0 QSR`. Go to the Plasma tab → right column → select each tier → click **Get Plasma**. Expected: success toast "plasma.bot fused N QSR to your account!", and the account's plasma reflects the new fusion after refresh.

- [ ] **Step 2: Error mapping**

Immediately request again for the same account. Expected: warning toast "You already have an active plasma.bot fusion for this account." (`ADDRESS_UNAVAILABLE`). Confirm at least one other failure (e.g. block network in devtools → "Failed to get plasma…").

- [ ] **Step 3: Left column unchanged**

Confirm the self-fuse form (editable beneficiary, amount, balance hint, Fuse Plasma) and the full-width "Active Plasma Fusions" cancelable list behave exactly as before. Bot-created fusions correctly do NOT appear there.

- [ ] **Step 4: Extension layout**

Load the `dist-extension` build as an unpacked extension. Open the popup → Plasma tab. Expected: the two columns stack vertically and the bot panel is fully usable in the narrow popup.

- [ ] **Step 5: Final gate**

Run: `npx vue-tsc --noEmit && npm run lint && npm run build && npm run build:extension`
Expected: all pass.

---

## Self-Review (completed during authoring)

**Spec coverage:** config (Task 2), service (Task 3), composable (Task 4), two-column UI + tiers + locked beneficiary + error mapping + balance refresh (Task 5), manifest host permission (Task 6), plasma.bot CORS change (Task 7), manual verification incl. extension stacking (Task 8). All spec sections map to a task.

**Placeholder scan:** no TBD/TODO; all code blocks are concrete. The two "verify the variant/typecheck command exists" notes are explicit verification steps, not deferred work.

**Type consistency:** `PlasmaBotTierKey`, `PlasmaBotError`, `PlasmaBotFuseSuccess`, `PLASMA_BOT_TIERS`, `PlasmaBotTier`, `fuse(address, tier)`, `isFusing`/`lastResult`/`error` are named identically across Tasks 2–5. Composable exposes refs accessed as `plasmaBot.isFusing.value` in the component, consistent with the existing `plasma.isFusing.value` usage in the same file.

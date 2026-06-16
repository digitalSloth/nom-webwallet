# Architecture

This document describes how NoM Wallet is structured internally. It is written against the current source; file paths are given so each claim can be checked against the code.

## Overview

NoM Wallet is a Vue 3 + TypeScript application that ships as two build targets from one codebase:

- a **standalone web app**, and
- a **Chrome/Edge browser extension** (Manifest V3).

Both targets share the same application code under `src/` and the same shared component library, `nom-ui` (an external package installed from GitHub). All blockchain and wallet logic lives in a platform-agnostic **service layer**; the differences between web and extension are confined to the storage backend and the build configuration.

## Build targets

The shared shadcn-vue component library lives in a separate repository and is consumed as an external dependency: `"nom-ui": "github:digitalSloth/nom-ui"` in `package.json`. Components import it by its bare package name (`import { Button } from 'nom-ui'`).

Two Vite configs drive the two targets:

| Target    | Config                     | Output            | Notes                                                                                  |
| --------- | -------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Web       | `vite.config.web.ts`       | `dist/`           | Vue + Tailwind + node polyfills; custom plugin copies the SDK's PoW assets (see below) |
| Extension | `vite.config.extension.ts` | `dist-extension/` | Uses `@crxjs/vite-plugin` with `manifest.json`                                         |

Both configs define a single `@` alias mapping to `src/` (`resolve.alias`). `nom-ui` is resolved from `node_modules` like any other dependency; the web config also lists it (alongside `znn-typescript-sdk`) in `optimizeDeps.exclude`.

### Proof-of-work assets

`znn-typescript-sdk` loads `pow.js` and `pow.wasm` from the web root at runtime. Vite doesn't know about these files, so `vite.config.web.ts` defines a `copyPowFiles` plugin that serves them from the SDK's `dist/browser` directory during dev and copies them into the build output during production. The SDK itself is excluded from dependency pre-bundling (`optimizeDeps.exclude`).

## Layered structure

```
Components / Pages (src/components, src/pages)
        │  import only from @/core and nom-ui
        ▼
Composables (src/core/composables)        ← reactive Vue wrappers
        │  call Service.getInstance()
        ▼
Services (src/core/*-service.ts)          ← business / blockchain logic
        │
        ├── ZenonService     → znn-typescript-sdk (network + PoW)
        ├── StorageService   → StorageAdapter (localStorage / chrome.storage)
        └── SessionManager   → in-memory unlocked KeyStores
```

The boundary between layers is deliberate and enforced by the barrel file. `src/core/index.ts` re-exports composables, selected types, and formatters, but **not** the service classes, storage adapters, or session manager. Its header comment states this explicitly: components are expected to consume functionality only through composables, never by importing a service directly.

## Service layer

Services hold all business logic and are the only code that talks to the SDK. Each service in `src/core/` follows the same shape: a `getInstance()` singleton accessor and an `ensureInitialized()` method that guarantees the underlying `ZenonService` connection is ready before use.

| Service              | File                     | Responsibility (public surface)                                                                                                                                                            |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WalletService`      | `wallet-service.ts`      | Create (`KeyStore.newRandom`) / import (`KeyStore.fromMnemonic`) wallets, encrypt & persist keystores, unlock/lock, derive accounts, rename, hide/show, delete, export mnemonic, sign data |
| `AccountService`     | `account-service.ts`     | `getAccountInfo`, `getPlasmaInfo`, `getPlasmaLevel`, `getUnreceivedBlocks`, `getDelegatedPillar`                                                                                           |
| `TransactionService` | `transaction-service.ts` | `sendTransaction`, `receiveTransaction`, `sendEmbeddedContractBlock`                                                                                                                       |
| `PlasmaService`      | `plasma-service.ts`      | `getFusionEntries`, `createFuseBlock`, `createCancelBlock`                                                                                                                                 |
| `StakeService`       | `stake-service.ts`       | `getStakeEntries`, `createStakeBlock`, `createCancelStakeBlock`                                                                                                                            |
| `RewardsService`     | `rewards-service.ts`     | `getAllUncollectedRewards`, `getUncollectedReward`, `createCollectRewardBlock` (pillar, sentinel, stake, liquidity)                                                                        |
| `PillarService`      | `pillar-service.ts`      | `getAllPillars` (paged), `createDelegateBlock`, `createUndelegateBlock`, `getTotalDelegatedZnn`                                                                                            |
| `TokenService`       | `token-service.ts`       | `getTokenByZts`                                                                                                                                                                            |
| `ZenonService`       | `zenon-service.ts`       | Singleton SDK connection; network + PoW configuration                                                                                                                                      |

### Read vs. write: the block-template pattern

State-changing operations are split in two:

1. The domain service **constructs** an `AccountBlockTemplate` — e.g. `PlasmaService.createFuseBlock`, `StakeService.createStakeBlock`, `PillarService.createDelegateBlock`, `RewardsService.createCollectRewardBlock`. These methods are synchronous and do no signing.
2. `TransactionService.sendEmbeddedContractBlock(block, keyPair)` signs and broadcasts the template using a `KeyPair` derived from an unlocked wallet.

Plain value transfers go through `TransactionService.sendTransaction`, and receiving an unreceived block goes through `TransactionService.receiveTransaction(blockHash, keyPair)`.

## Proof-of-Work

Zenon requires Proof-of-Work to produce a block's nonce when the sending account lacks the plasma to cover it. The SDK computes this in the browser via a WebAssembly module; the asset-serving side (`pow.js` / `pow.wasm`, `setPowBasePath('/')`, the `copyPowFiles` plugin) is covered under [Build targets](#proof-of-work-assets) above. How the work is _scheduled_ is decided in `ZenonService` (`src/core/zenon-service.ts`):

- **Configuration is one-time and idempotent.** Static flags (`powConfigured`, `powWorkerEnabled`) guard setup so it runs once across the singleton's lifetime.
- **Web app → off-thread worker.** When _not_ in an extension context and `isPowWorkerSupported()` is true, the service calls `Zenon.usePowWorker()` and registers it via `Zenon.setPowProvider(...)`. Running PoW off the main thread keeps the UI responsive and stops the long computation from starving the node WebSocket heartbeat (which previously dropped the connection mid-send).
- **Extension → main-thread fallback.** `isExtensionContext()` (detected via `chrome.runtime?.id`) returns true inside the MV3 popup/worker, where the CSP `script-src 'self'` forbids the SDK's `blob:`-based worker. The service skips worker setup and lets the SDK use its synchronous main-thread WASM generator.
- **Defensive fallback.** Worker creation is wrapped in try/catch; if it throws (e.g. a strict CSP elsewhere), the failure is logged and the SDK transparently falls back to main-thread PoW rather than breaking the send.

`src/core/pow-status.ts` exposes a reactive `isGeneratingPow` flag for the UI. It is driven by `trackPow`, a wrapper conforming to the SDK's `PowProvider` signature that increments/decrements an in-flight counter around each generation. Because only the off-thread worker path is wrapped with `trackPow`, this reactive flag reflects PoW activity in the **web app**; in the extension (main-thread generator, no pluggable provider) operation-level toasts cover the feedback instead.

## Composables

`src/core/composables/` contains one composable per service plus a few helpers. The exported set (`src/core/composables/index.ts`): `useWallet`, `useAccount`, `useNetwork`, `useTransaction`, `usePlasma`, `useStake`, `useRewards`, `usePillar`, `useToken`, `useStorage`, and `runActivity` (from `useActivity`), along with the formatter utilities.

The composables use a **module-level singleton** pattern. Reactive state (`ref`/`computed`) is declared at module scope — _outside_ the exported function — so every component that calls e.g. `useWallet()` shares the same state rather than getting its own copy. The function body wires up the methods and returns them. `useWallet` also caches a one-time `loadPromise` so the router guard and `App.vue` don't each trigger a separate initial load on startup.

Inside the composable, the corresponding service is obtained via `Service.getInstance()` (e.g. `WalletService.getInstance()`). State changes are mediated through `window` `CustomEvent`s where cross-cutting notification is needed — for example, lock/unlock dispatches a `wallet-status-changed` event that `Home.vue` listens for to reload.

## Storage abstraction

All persistence goes through the `StorageAdapter` interface (`src/types/wallet.ts`):

```ts
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}
```

Two implementations exist in `src/core/storage/`:

- `LocalStorageAdapter` — browser `localStorage` (web app)
- `ChromeStorageAdapter` — `chrome.storage.local` (extension)

The adapter is **not** selected in `main.ts`. Instead, `StorageService` (`src/core/storage/storage-service.ts`) auto-detects the environment in its constructor: if `chrome.storage.local` is present and accessible it uses `ChromeStorageAdapter`, otherwise it falls back to `LocalStorageAdapter`. A module-level singleton `storageService` is exported and consumed by `WalletService`.

The persisted shape is `WalletStorage` (`{ wallets, activeWalletAddress, activeAccountAddress }`); each `Wallet` carries its `encryptedKeyFile`, `accounts`, `name`, `baseAddress`, and `createdAt`.

## Key handling, encryption, and sessions

Key material is handled by the SDK's `KeyStore` / `KeyFile` types:

- **Create**: `KeyStore.newRandom()`.
- **Import**: `KeyStore.fromMnemonic(mnemonic)`.
- **Persist**: `WalletService.saveWallet` calls `KeyFile.setPassword(password)` then `keyFile.encrypt(keyStore)`, storing only the encrypted result as `encryptedKeyFile`. The encrypted structure (`KeyFileEncryptedData` in `src/types/wallet.ts`) records an Argon2-based KDF and cipher parameters. **Private keys are never persisted in plaintext.**
- **Unlock**: `KeyFile.setPassword(password)` + `keyFile.decrypt(encryptedKeyFile)` yields a `KeyStore`, which is handed to the session manager.
- **Sign**: `WalletService.signData` resolves a `KeyPair` from an unlocked `KeyStore` and signs.

`SessionManager` (`src/core/session-manager.ts`) holds unlocked `KeyStore`s in an in-memory `Map`, keyed by base address, each stamped with an `unlockedAt` time. `isUnlocked` enforces a **30-minute** timeout (`sessionTimeout = 30 * 60 * 1000`) and evicts expired sessions on access. Nothing here is persisted, so locking — or reloading the app — discards the unlocked keys. A module-level singleton `sessionManager` is exported (note: this is a plain exported instance, not a `getInstance()` accessor like the other services).

## Routing and navigation guards

Routes are defined in `src/router.ts` using `createWebHistory`:

| Path                    | Page               | Meta                               |
| ----------------------- | ------------------ | ---------------------------------- |
| `/`                     | `Home.vue`         | `requiresWallet`                   |
| `/setup`                | `Setup.vue`        | —                                  |
| `/send`                 | `Send.vue`         | `requiresWallet`, `requiresUnlock` |
| `/receive`              | `Receive.vue`      | `requiresWallet`                   |
| `/token/:tokenStandard` | `TokenDetails.vue` | `requiresWallet`                   |
| `/:pathMatch(.*)*`      | → redirect `/`     | —                                  |

A global `beforeEach` guard enforces wallet state. It first calls `wallet.ensureLoaded()` (the guard can run before `App.vue`'s `onMounted` on a hard refresh), then:

- `requiresWallet` route with no wallets → redirect to `/setup`.
- `/setup` while wallets already exist → redirect to `/`.
- `requiresUnlock` route while the active wallet is locked → redirect to `/` with an `unlock` query holding the original target. `App.vue` reads that query, opens the unlock dialog, and navigates to the target on success.

## Entry points

- **`src/main.ts`** — web/extension app entry. Installs `Buffer` on `globalThis` for the SDK, registers a global Vue `errorHandler` that surfaces uncaught errors via a toast, installs the router, and mounts `App.vue`.
- **`src/background.ts`** — the extension's MV3 service worker. It is currently a minimal stub: an `onInstalled` listener and a no-op `onMessage` handler. Wallet storage in the extension is accessed directly via `chrome.storage.local` from the popup context, not proxied through the worker.
- **`manifest.json`** — MV3 manifest. Requests only the `storage` permission; the popup is `index.html`; the background `service_worker` is `src/background.ts` (module type).

## Configuration

Shared constants live in `src/config.ts` — the default node URL (`wss://node.zenonhub.io:35998`) and the built-in node list, momentum/block timing, plasma fusion minimums and revoke lock, staking minimums and the 30-day "month" duration options, and the minimum password length. Prefer importing from here over hardcoding values in components.

## Conventions

- **No semicolons, single quotes, 100-char width** (`.prettierrc.json`).
- **Strict TypeScript** is the primary correctness check; there is no automated test suite (`npm run typecheck` + `npm run lint`).
- **PascalCase** for components, **camelCase** for services and functions.
- **No Pinia/Vuex** — shared state is the module-level reactive state inside composables.

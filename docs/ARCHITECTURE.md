# Architecture

This document describes how NoM Wallet is structured internally. It is written against the current source; file paths are given so each claim can be checked against the code.

## Overview

NoM Wallet is a Vue 3 + TypeScript application that ships as two build targets from one codebase:

- a **standalone web app**, and
- a **Chrome/Edge browser extension** (Manifest V3).

Both targets share the same application code under `src/` and the same shared component library, `nom-ui` (an external package installed from GitHub). All blockchain and wallet logic lives in a platform-agnostic **service layer**. The two targets also share the small app (`src/apps/small/`); each host adds its own root, router and host features (see [App folders](#app-folders)).

## Build targets

The shared shadcn-vue component library lives in a separate repository and is consumed as an external dependency: `"nom-ui": "github:digitalSloth/nom-ui"` in `package.json`. Components import it by its bare package name (`import { Button } from 'nom-ui'`).

Two Vite configs drive the two targets:

| Target    | Config                     | Output            | Notes                                                                                  |
| --------- | -------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| Web       | `vite.config.web.ts`       | `dist/`           | Vue + Tailwind + node polyfills; custom plugin copies the SDK's PoW assets (see below) |
| Extension | `vite.config.extension.ts` | `dist-extension/` | Uses `@crxjs/vite-plugin` with `manifest.json`                                         |

Both configs define a single `@` alias mapping to `src/` (`resolve.alias`). `nom-ui` is resolved from `node_modules` like any other dependency; the web config also lists it in `optimizeDeps.exclude`.

### Proof-of-work assets

`znn-typescript-sdk` loads `pow.js` and `pow.wasm` from the app root at runtime. Vite doesn't know about these files, so `vite.shared.ts` defines a `copyPowFiles` plugin — shared by both the web and extension builds — that serves them from the SDK's `lib` directory during dev and copies them into the build output during production. The SDK ships ESM only, so Vite pre-bundles it like any other dependency; that pre-bundling converts its CommonJS dependencies (`rpc-websockets`, `eventemitter3`) for the browser.

## Layered structure

```
Components / Pages (src/apps/<app>/, src/shared/)
        │  import from @/core, @/shared and nom-ui
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

## App folders

| Folder                | Holds                                                                                                                                          | May import                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `src/apps/small/`     | The small app's pages, components, `smallRoutes`, `TabBar` and `SmallHost`                                                                     | `@/core`, `@/shared`, `@/config`, `@/types`, `nom-ui` |
| `src/apps/extension/` | The extension host: surfaces, approval window, side panel approvals, WalletConnect window, Locked, `useExtensionShell` and its router          | `small`, `core`, `shared`      |
| `src/apps/web/`       | The web host and the large app: `WebApp.vue`, `useWebShell`, `useWebSession`, `SmallLayout`, `WebLayout`, the sidebar, large pages and dialogs | `small`, `core`, `shared`      |

`npm run lint` enforces four rules:

- `src/apps/small/` may not import web or extension code, and may not read `chrome` or `__IS_EXTENSION__`.
- The web app may not import extension code.
- The extension may not import web code.
- `src/core/` and `src/shared/` may not import `src/apps/`.

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
- **Off-thread worker in both apps.** When `isPowWorkerSupported()` is true, the service calls `Zenon.usePowWorker()` and registers it via `Zenon.setPowProvider(...)`. Running PoW off the main thread keeps the UI responsive and stops the long computation from starving the node WebSocket heartbeat.
  - **Extension pages:** the SDK's default worker starts from a `blob:` URL, and a `blob:` worker on an extension page cannot `import()` `pow.js`. The service passes `createWorker` to `usePowWorker`, which starts `src/core/pow-worker.ts`: Vite emits it as a module worker on the extension's own origin, and it calls the SDK's `servePowRequests()`. The SDK's `pow.js` uses no `eval` or `new Function`, so the extension page CSP (`script-src 'self' 'wasm-unsafe-eval'`) is enough. The extension service worker has no `Worker` and never generates PoW.
- **Defensive fallback (web).** Worker creation is wrapped in try/catch; if it throws (e.g. a strict CSP elsewhere), the failure is logged and the SDK transparently falls back to main-thread PoW rather than breaking the send.

`src/core/pow-status.ts` exposes a reactive `isGeneratingPow` flag for the UI. It is driven by `trackPow`, a wrapper conforming to the SDK's `PowProvider` signature that increments/decrements an in-flight counter around each generation. The worker's generator is wrapped with `trackPow`, so this reactive flag reflects PoW activity in both apps.

## Composables

`src/core/composables/` contains one composable per service plus a few helpers. The exported set (`src/core/composables/index.ts`): `useWallet`, `useAccount`, `useNetwork`, `useNodes`, `useTransaction`, `usePlasma`, `useStake`, `useRewards`, `usePillar`, `useToken`, `useStorage`, and `runActivity` (from `useActivity`), along with the formatter utilities.

The composables use a **module-level singleton** pattern. Reactive state (`ref`/`computed`) is declared at module scope — _outside_ the exported function — so every component that calls e.g. `useWallet()` shares the same state rather than getting its own copy. The function body wires up the methods and returns them. `useWallet` also caches a one-time `loadPromise` so the router guard and the app shell don't each trigger a separate initial load on startup.

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
- **Change password**: `WalletService.changePassword` decrypts with the current password, re-encrypts the same `KeyStore` with the new one and replaces only that wallet's `encryptedKeyFile` (compare-and-swap). Unlocked sessions are unaffected.
- **Restore**: `WalletService.restoreWallet` imports a phrase. When a wallet with the phrase's base address already exists, it replaces that wallet's `encryptedKeyFile` with one under the new password (name, accounts and labels stay), makes it the active wallet and unlocks it. The target is found only from the phrase, so a key file cannot be replaced without that wallet's phrase. Only the extension calls it.
- **Sign**: `WalletService.signData` resolves a `KeyPair` from an unlocked `KeyStore` and signs.

`SessionManager` (`src/core/session-manager.ts`) holds unlocked `KeyStore`s in an in-memory `Map`, keyed by base address, each stamped with an `unlockedAt` time. `isUnlocked` enforces a **30-minute** timeout (`sessionTimeout = 30 * 60 * 1000`) and evicts expired sessions on access. Nothing here is persisted, so locking — or reloading the app — discards the unlocked keys. A module-level singleton `sessionManager` is exported (note: this is a plain exported instance, not a `getInstance()` accessor like the other services).

In the extension, `src/core/key-cache.ts` mirrors each unlocked wallet's entropy into `chrome.storage.session` (`nom-wallet.key:<baseAddress>`, trusted contexts only), so the popup, a tab, the approval window and the WalletConnect window share one unlock. Expiry there is the auto-lock time chosen in Security (5, 15, 30 or 60 minutes of inactivity, default 30), stored in `chrome.storage.local` under `nom-wallet-auto-lock-minutes`. Entries are wiped on lock, lock all, auto-lock (page timer and `chrome.alarms`), wallet removal and the last browser window closing. Chrome clears the area when it quits. The web app keeps the in-memory behaviour above.

## Routing and navigation guards

The web router (`src/apps/web/routes.ts`, `createWebHistory`) builds a two-view record from each `smallRoutes` record (`small` and `large` named views, with path, name, meta and guards from the small record) and adds the large-only records. The extension builds its router in `src/apps/extension/routes.ts` (hash history, with `requiresUnlock`) from the same `smallRoutes` plus its own `/walletconnect`, `/locked` and catch-all.

Web (`src/apps/web/routes.ts`):

| Path                                                                                              | Small view                                                       | Large view                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| `/`                                                                                               | `Home`                                                           | `Dashboard`                                  |
| `/send`                                                                                           | `Send`                                                           | `Send`                                       |
| `/send/review`                                                                                    | `SendReview`                                                     | —                                            |
| `/receive`                                                                                        | `Receive`                                                        | `Receive`                                    |
| `/activity`                                                                                       | —                                                                | `Activity`                                   |
| `/token/:tokenStandard`                                                                           | `TokenDetails`                                                   | `TokenDetails`                               |
| `/tx/:hash`                                                                                       | `TxTracker`                                                      | `TxTracker`                                  |
| `/interrupted`                                                                                    | `TxInterrupted`                                                  | `Dashboard` + `InterruptedDialog`            |
| `/plasma`                                                                                         | `Plasma`                                                         | `Plasma`                                     |
| `/rewards`                                                                                        | `Rewards`                                                        | `Rewards`                                    |
| `/pillars`, `/staking`, `/tokens`, `/tokens/issue`                                                | —                                                                | `Pillars`, `Staking`, `Tokens`, `TokenIssue` |
| `/settings`                                                                                       | `Settings`                                                       | —                                            |
| `/settings/wallets`, `/settings/security`, `/settings/network`                                    | `WalletSelector`, `Security`, `Network`                          | `SettingsLayout` tabs                        |
| `/settings/wallets/:address`, `/export`, `/password`, `/remove`                                   | `ManageWallet`, `ExportPhrase`, `ChangePassword`, `RemoveWallet` | —                                            |
| `/apps`                                                                                           | `SmallConnectedApps`                                             | `ConnectedApps`                              |
| `/welcome`, `/create/password`, `/create/phrase`, `/create/verify`, `/import`, `/import/password` | onboarding small pages                                           | onboarding pages (`layout: 'bare'`)          |
| `/walletconnect`, `/setup`, `/:pathMatch(.*)*`                                                    | redirects to `/apps`, `/welcome`, `/`                            | redirects                                    |

A route with no view for the current layout moves as follows (`fallbackFor`, `src/apps/web/layout-fallback.ts`):

| Route                                              | Layout | Goes to                |
| -------------------------------------------------- | ------ | ---------------------- |
| `/activity`                                        | small  | `/?tab=activity`       |
| `/pillars`, `/staking`, `/tokens`, `/tokens/issue` | small  | `/` plus an info toast |
| `/send/review`                                     | large  | `/send`                |
| `/settings` and the manage pages                   | large  | `/settings/wallets`    |

Extension (`src/apps/small/routes.ts` and `src/apps/extension/routes.ts`): every route below has `requiresWallet`, and `requiresUnlock` unless noted.

- Main: `/`, `/send`, `/send/review`, `/receive`, `/token/:tokenStandard`, `/tx/:hash`, `/interrupted`, `/plasma`, `/rewards`.
- Settings: `/settings`, `/settings/security`, `/settings/network`, `/apps`.
- Wallets: `/settings/wallets`, `/settings/wallets/:address`, `/settings/wallets/:address/export`, `/settings/wallets/:address/password`, `/settings/wallets/:address/remove`.
- The `tabBar` route meta shows the small app's `TabBar` on `/`, `/send`, `/receive`, `/rewards` and `/settings`; `ExtensionApp.vue` and the web's `SmallLayout.vue` render it below the router view.
- `/walletconnect`: `layout: 'bare'`, no `requiresUnlock`. `/locked`: `requiresWallet` only.
- Onboarding, no wallet needed: `/welcome`, `/create/password`, `/create/phrase`, `/create/verify`, `/import`, `/import/password`.
- `/:pathMatch(.*)*` redirects to `/`.

A global `beforeEach` guard calls `wallet.ensureLoaded()` (the guard can run before the root's `onMounted` on a hard refresh), then redirects a `requiresWallet` route with no wallets to `/welcome`. The guard never checks the lock: the lock gate in `WebApp.vue` covers a locked wallet and keeps its URL, so the same page shows after an unlock. The web guard then applies `fallbackFor`, and makes a locked, non-active wallet active before its manage page opens.

## Entry points

- **`src/apps/web/main.ts`** (loaded by `index.html`) and **`src/apps/extension/main.ts`** (loaded by `popup.html`) — the web app and extension popup entries. Each mounts its own root layout (`WebApp.vue`, `ExtensionApp.vue`) with its own router (web history, hash history) through `bootstrapApp` in `src/app-shell/bootstrap.ts`, which installs `Buffer` on `globalThis` for the SDK and registers a global Vue `errorHandler` that surfaces uncaught errors via a toast. `WebApp.vue` renders `SmallLayout` or `WebLayout` by `layoutFor`, calls `useWebShell()` for startup loading, watchers, the web host (`provideWebHost`; `requestUnlock` moves to the page and the lock gate asks for the password) and the resize fallback, calls `useWebSession()` for the lock gate, and mounts `DappRequestDialog` and `NetworkLinkDialog`. `ExtensionApp.vue` calls `useExtensionShell()` instead, which loads startup data, provides the small-app host (`provideExtensionHost`; its `requestUnlock` routes to the Locked screen) and watches for locks. The extension's pages live in `src/apps/small/` except Locked and WalletConnectWindow.
- **`src/background.ts`** — the extension's MV3 service worker. It is currently a minimal stub: an `onInstalled` listener and a no-op `onMessage` handler. Wallet storage in the extension is accessed directly via `chrome.storage.local` from the popup context, not proxied through the worker.
- **`manifest.json`** — MV3 manifest. Requests only the `storage` permission; the popup is `popup.html`; the background `service_worker` is `src/background.ts` (module type).

## Configuration

Shared constants live in `src/config.ts` — the default node URL (`wss://node.zenonhub.io:35998`) and the built-in node list (`NodeEntry` values on chain 1 and network 1; each custom node stores its own chain and network ID, read by `useNodes` through `src/core/custom-nodes.ts`), momentum/block timing, plasma fusion minimums and revoke lock, staking minimums and the 30-day "month" duration options, and the minimum password length. Prefer importing from here over hardcoding values in components.

## Conventions

- **No semicolons, single quotes, 100-char width** (`.prettierrc.json`).
- **Validation** uses Vitest for focused `SessionManager` unit coverage (`npm test`), strict
  TypeScript (`npm run typecheck`), and ESLint (`npm run lint`).
- **PascalCase** for components, **camelCase** for services and functions.
- **No Pinia/Vuex** — shared state is the module-level reactive state inside composables.

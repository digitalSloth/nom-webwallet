# NoM WebWallet

A cryptocurrency wallet for the Zenon Network, supporting both browser extension (Chrome/Edge, Manifest V3) and standalone web application modes.

## Tech Stack

- **Framework**: Vue 3 (Composition API)
- **Build Tool**: Vite
- **Styling**: Tailwind CSS 4 + shadcn-vue + Reka UI
- **Language**: TypeScript (strict mode)
- **Blockchain**: znn-typescript-sdk (Zenon Network)
- **Package Manager**: npm
- **UI Library**: `nom-ui` — external shadcn-vue component library (`github:digitalSloth/nom-ui`)

## Project Structure

```
nom-webwallet/
├── src/
│   ├── core/               # Business logic services
│   │   ├── composables/    # Vue 3 reactive wrappers around services
│   │   └── storage/        # Storage adapters (localStorage / chrome.storage)
│   ├── types/              # TypeScript type definitions
│   ├── apps/               # small/ (the compact UI: extension, and web at 900 px and below), extension/ (extension host) and web/ (web host and the large UI)
│   ├── app-shell/          # Startup (bootstrap.ts) shared by both apps
│   ├── shared/             # Surface-free helpers and components both apps import
│   └── background.ts       # Extension service worker
├── vite.config.web.ts      # Web app build config
├── vite.config.extension.ts# Extension build config
└── manifest.json           # Chrome extension manifest (MV3)
```

## Commands

```bash
npm install               # Install dependencies
npm run dev               # Web dev server (localhost:5173)
npm run dev:extension     # Extension watch build
npm run build             # Web production build → dist/
npm run build:extension   # Extension production build → dist-extension/
npm test                  # Run Vitest unit suite
npm run typecheck         # Type-check with vue-tsc
npm run lint              # ESLint (TypeScript + Vue)
npm run format            # Prettier
```

## Architecture

**Service Layer** (`src/core/`): All blockchain and wallet business logic lives in service classes (`wallet-service.ts`, `transaction-service.ts`, `account-service.ts`, etc.).

**Composables** (`src/core/composables/`): Vue 3 composables wrap services for reactive state in components. Each service has a corresponding composable (`useWallet`, `useAccount`, `useTransaction`, etc.).

**Storage Abstraction**: `StorageAdapter` interface with `LocalStorageAdapter` (web) and `ChromeStorageAdapter` (extension). `StorageService` picks the adapter at startup.

**App folders**: `src/apps/small/` holds the small app's pages, components, `smallRoutes`, `TabBar` and `SmallHost`, and imports no web or extension code (only `@/core`, `@/shared`, `@/config`, `@/types` and `nom-ui`). `src/apps/extension/` holds the extension host: surfaces, approval window, side panel approvals, WalletConnect window, Locked, `useExtensionShell` and its router. `src/apps/web/` holds the web host and the large app: `WebApp.vue`, `useWebShell`, `useWebSession`, `SmallLayout`, `WebLayout`, the sidebar, large pages and dialogs. Both hosts import `small`, `core` and `shared`.

**Entry Points**: `src/apps/web/` (web app, `index.html`) and `src/apps/extension/` (popup, `popup.html`) each have their own `main.ts`, root layout and router. Both start through `bootstrapApp` (`src/app-shell/bootstrap.ts`). The web root (`WebApp.vue`) calls `useWebShell` (startup, watchers, the web `SmallHost` and the resize fallback) and `useWebSession` (lock gate), renders `SmallLayout` (the small app and its tab bar) at 900 px and below and `WebLayout` (sidebar and large pages) above, and mounts the dApp request dialog and the network link dialog (`useDeepLink`) above both and the locked overlay. `sidepanel.html` also runs the extension app, as the side panel surface. The side panel shows dApp requests from tabs in its own window over its current page (`approval/panel-approvals.ts`); other requests use the approval window. The extension's approval window is a third entry (`approve.html`). The small app's pages reach host features (place label, version, unlock, the connections row, extra Settings rows) through `SmallHost` (`src/apps/small/host.ts`), which `useExtensionShell` and `ApproveApp.vue` provide through `provideExtensionHost`, and `useWebShell` through `provideWebHost`; Locked and WalletConnectWindow stay in `src/apps/extension/`. Surface-free helpers and components live in `src/shared/`; `npm run lint` fails when the web app imports extension code, the extension imports web code, `src/apps/small/` imports web or extension code or reads `chrome` or `__IS_EXTENSION__`, or `src/core/` or `src/shared/` imports `src/apps/`.

**Breakpoint**: the web app has one breakpoint at 900 px. `PHONE_QUERY` and `usePhoneLayout()` in `src/apps/web/breakpoint.ts` choose the layout: the small app at 900 px and below, the large app above. The `phone:` and `desktop:` variants in `src/style.css` match the query; `sheet.ts` needs them for `DappRequestDialog` and `NetworkLinkDialog`, which render in both layouts, and some large pages and dialogs still carry `desktop:` classes. `fallbackFor` (`src/apps/web/layout-fallback.ts`) moves a route with no view for the layout, in the router guard and when the window crosses 900 px.

**Session Management**: Unlocked wallets are held in memory only via `SessionManager`. The extension shares unlocks between its documents through `key-cache.ts`; each web tab keeps its own keys, and `web-session.ts` adds activity-based auto-lock, a cross-tab lock over `BroadcastChannel` and storage-event sync. No private keys are persisted unencrypted.

**Nodes**: each node is a `NodeEntry` (`url`, `chainId`, `networkId`). Built-in nodes in `DEFAULT_NODES` are chain 1 / network 1. Custom nodes live in `src/core/custom-nodes.ts` with their own IDs, and `useNetwork().selectNode` connects, checks the chain, then stores the node and its IDs. `useNodes` drives both Network pages, whose Check step reads the chain ID through `src/core/node-probe.ts` without touching the wallet connection.

**Singletons**: `ZenonService` (blockchain connection) and `SessionManager` use `getInstance()` pattern.

## Routes

Web routes live in `src/apps/web/routes.ts`. Each record has a `small` view, a `large` view, or both: it takes every `smallRoutes` record with its guards and adds the large page.

- `/` — Home (small) and Dashboard (large)
- `/welcome`, `/create/password`, `/create/phrase`, `/create/verify`, `/import`, `/import/password` — First run: create or import a wallet
- `/send` (both), `/send/review` (small) — Send and its review
- `/receive` (both)
- `/activity` — large; small falls back to `/?tab=activity`
- `/token/:tokenStandard`, `/tx/:hash`, `/plasma`, `/rewards` (both)
- `/interrupted` — small page, large dialog over Dashboard
- `/pillars`, `/staking`, `/tokens`, `/tokens/issue` — large; small falls back to `/` with a toast
- `/apps` — Connected apps (both; `/walletconnect` redirects here)
- `/settings` — small; large falls back to `/settings/wallets`
- `/settings/wallets`, `/settings/security`, `/settings/network` (both)
- `/settings/wallets/:address` with `/export`, `/password`, `/remove` — small; large falls back to `/settings/wallets`

Extension routes are the small app's `smallRoutes` (`src/apps/small/routes.ts`) plus `/walletconnect`, `/locked` and a catch-all in `src/apps/extension/routes.ts`: `/`, `/send`, `/send/review`, `/receive`, `/token/:tokenStandard`, `/tx/:hash`, `/interrupted`, `/plasma`, `/rewards`, `/settings`, `/settings/security`, `/settings/network`, `/apps`, `/settings/wallets` (and `/settings/wallets/:address` with `/export`, `/password`, `/remove`), `/walletconnect`, `/locked`, plus the onboarding routes above. A `tabBar: true` route meta shows the small app's `TabBar` (`ExtensionApp.vue`, `SmallLayout.vue`) on Home, Send, Receive, Rewards and Settings.

## Code Style

- No semicolons, single quotes, 100-char print width (see `.prettierrc.json`)
- Strict TypeScript mode
- PascalCase for Vue components, camelCase for services/functions
- No Pinia/Vuex — state managed via composables only

## Testing

Vitest provides focused unit coverage for `SessionManager`. Validate changes with `npm test`,
`npm run typecheck`, and `npm run lint`.

## Gotchas

- `injectSmallHost()` throws when no root provided the host, so any root rendering a small page or component calls `provideExtensionHost` or `provideWebHost`.
- Web route records use the named views `small` and `large`, so a router test reads `matched[0].components?.small` or `.large`, never `.default`, and must mock every small and large page it navigates to.
- `installFakeChrome` storage calls wait on `setTimeout(0)`, so under fake timers a bare `await` on storage hangs. Advance with `vi.advanceTimersByTimeAsync`, and call `vi.resetModules()` per test for modules that hold state.
- `useApprovalControls` only tracks the rendered request id after the queue head changes, so tests must create it with an empty head and set the request afterwards.
- `listApprovals()` drops expired entries, so a test of an expired request asserts on handler calls, not on the queue contents.
- `@vue/runtime-dom` calls `document.createElement` at import when `document` exists, so a test that stubs `document` with a bare `EventTarget` must import Vue modules before the stub and must not call `vi.resetModules()` after it.
- `it.each` titles with `%j` throw `Do not know how to serialize a BigInt` when a case holds a bigint, so use `%s` with a named case.
- `runtime.getContexts` reports `windowId: -1` and `tabId: -1` for SIDE_PANEL contexts, so never filter them by window. The panel registers its window over the `znn-side-panel` port (`src/sw/side-panel-approvals.ts`), and the fake `getContexts` in `src/test/fake-chrome.ts` follows Chrome.
- No `@vue/test-utils` and Vitest runs in Node, so `.vue` files cannot be mounted: keep logic in `.ts` modules and mock `.vue` pages with `vi.doMock`.
- `src/sw/side-panel-approvals.ts` sweeps on import, so panel entries seeded before the import are rejected unless `SESSION_KEY_SIDE_PANELS` maps their window to a document id and `env.contexts` holds `sidePanelContext(thatId)`. A panel hello is `{ windowId, token: panelTokenFor(thatId) }`.
- A side panel's sender is only `{ id, url, origin }`, so `src/core/panel-token.ts` tags the panel URL with `?panel=<token>` (`src/apps/extension/router.ts` does it before the hash history is created) and the worker finds the document by that token in `getContexts` `documentUrl`.
- After `vi.resetModules()`, a class or recorder imported statically at the top of a test is a different instance from the one the module under test loads, so `instanceof` fails and `setSendRecorder` has no effect: import them with `await import()` after the reset.
- Pending keys in `pending-calls.ts` live for the whole test file and a mocked tracker never finishes them, so each test of a send flow needs its own account or token.

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
│   ├── components/         # Vue components
│   ├── pages/              # Route components
│   ├── types/              # TypeScript type definitions
│   ├── main.ts             # App entry point
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
npm run lint              # ESLint (TypeScript + Vue)
npm run format            # Prettier
```

## Architecture

**Service Layer** (`src/core/`): All blockchain and wallet business logic lives in service classes (`wallet-service.ts`, `transaction-service.ts`, `account-service.ts`, etc.).

**Composables** (`src/core/composables/`): Vue 3 composables wrap services for reactive state in components. Each service has a corresponding composable (`useWallet`, `useAccount`, `useTransaction`, etc.).

**Storage Abstraction**: `StorageAdapter` interface with `LocalStorageAdapter` (web) and `ChromeStorageAdapter` (extension). Adapter is selected at startup in `main.ts`.

**Session Management**: Unlocked wallets are held in memory only via `SessionManager` with a 30-minute auto-timeout. No private keys are persisted unencrypted.

**Singletons**: `ZenonService` (blockchain connection) and `SessionManager` use `getInstance()` pattern.

## Routes

- `/` — Home dashboard
- `/setup` — Wallet creation/import
- `/send` — Send transaction
- `/receive` — Receive address
- `/token/:tokenStandard` — Token details

## Code Style

- No semicolons, single quotes, 100-char print width (see `.prettierrc.json`)
- Strict TypeScript mode
- PascalCase for Vue components, camelCase for services/functions
- No Pinia/Vuex — state managed via composables only

## Testing

No automated test suite. TypeScript strict mode is the primary correctness check.

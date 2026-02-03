# NoM Wallet

A self-custody cryptocurrency wallet for the [Zenon Network](https://zenon.network) (Network of Momentum). NoM Wallet runs both as a **browser extension** (Chrome/Edge, Manifest V3) and as a **standalone web app**, sharing the same wallet logic and interface across both.

Your keys stay on your device. Wallets are encrypted with a password you choose, and the unlocked keys live only in memory for the duration of your session.

## Features

- **Create or import wallets** from a mnemonic phrase, with multiple derived accounts per wallet
- **Send and receive** ZNN, QSR, and other ZTS tokens
- **Plasma** — fuse and cancel QSR to generate plasma for feeless transactions
- **Staking** — stake ZNN for fixed durations and collect rewards
- **Pillars** — delegate to a pillar and track delegation
- **Rewards** — view and collect uncollected pillar, sentinel, stake, and liquidity rewards
- **Multiple networks** — connect to the default Zenon node or point at your own
- **In-browser Proof-of-Work** — generates the required PoW locally when an account lacks plasma; nothing is outsourced
- **Password-encrypted storage** with an auto-locking session (30-minute inactivity timeout)

## Getting Started

### Prerequisites

- **Node.js** 20.19+ or 22.12+ (required by Vite 7)
- **npm** 7+ (required for workspaces)

### Install

```bash
npm install
```

### Run the web app

```bash
npm run dev
```

The app runs at `http://localhost:5173`.

### Build and load the browser extension

```bash
npm run build:extension
```

This produces an unpacked extension in `dist-extension/`. To load it:

1. Open `chrome://extensions/` in Chrome or Edge
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `dist-extension/` directory
4. The NoM Wallet icon appears in your toolbar

For active extension development, use watch mode and reload the extension after changes:

```bash
npm run dev:extension
```

## First Run

On first launch the wallet has no accounts, so you're taken to the **setup** flow to create a new wallet or import one from a mnemonic. After setup, the home dashboard shows your balances, with tabs for Tokens, Rewards, Plasma, Pillar, and Staking.

Sending a transaction requires the active wallet to be unlocked — if it's locked, the wallet prompts you for your password and then continues to the action.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the web app dev server (`localhost:5173`) |
| `npm run dev:extension` | Build the extension in watch mode |
| `npm run build` | Production build of the web app → `dist/` |
| `npm run build:extension` | Production build of the extension → `dist-extension/` |
| `npm run preview` | Preview the production web build |
| `npm run typecheck` | Type-check with `vue-tsc` |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with autofix |
| `npm run format` | Format with Prettier |

> There is no automated test suite. TypeScript strict mode, `typecheck`, and `lint` are the correctness checks.

## Tech Stack

- **Vue 3** (Composition API) + **Vite**
- **Tailwind CSS 4** with **shadcn-vue** / **Reka UI** components
- **TypeScript** (strict mode)
- **znn-typescript-sdk** for Zenon Network connectivity
- **npm workspaces** monorepo (`@nom/ui` shared component library)

## Project Layout

```
nom-webwallet/
├── src/                      # Application code (pages, components, core logic)
│   ├── core/                 # Services, composables, storage adapters
│   ├── components/           # Vue components
│   ├── pages/                # Routed views
│   ├── App.vue / main.ts     # App shell and entry point
│   └── background.ts         # Extension service worker
├── packages/ui/              # Shared shadcn-vue component library (@nom/ui)
├── vite.config.web.ts        # Web build config
├── vite.config.extension.ts  # Extension build config
└── manifest.json             # Chrome extension manifest (MV3)
```

For a detailed technical breakdown of the service layer, composables, storage abstraction, session handling, and routing, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security Notes

- Private keys are never written to storage in plaintext. Each wallet is persisted as a password-encrypted keystore.
- Unlocked keys are held in memory only and are cleared on lock or after the session timeout.
- Export your mnemonic and keep it somewhere safe — it is the only way to recover a wallet.

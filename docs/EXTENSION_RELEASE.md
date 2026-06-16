# Extension Release Checklist

## Build
1. Clean checkout: `npm ci`
2. Gates: `npm run typecheck && npm run lint && npm run build:extension`
3. Package: `npm run package:extension` → `dist-extension.zip`

## Load unpacked (manual verification)
1. Open `chrome://extensions`, enable Developer Mode.
2. "Load unpacked" → select `dist-extension/`.
3. Confirm: no manifest warnings, no CSP install errors.
4. Open the popup → no startup console errors.

## Core wallet smoke test (extension mode)
- [ ] Create wallet
- [ ] Import wallet
- [ ] Unlock / lock
- [ ] Dashboard renders balances
- [ ] Send a small testnet transaction — **BLOCKED: see "Known blocker: PoW under extension CSP" below.** Sends that require PoW currently fail in the extension.
- [ ] Receive address shows
- [ ] Switch network / node
- [ ] Reload popup → no route 404 (hash routing)
- [ ] Restart browser → encrypted wallet persists, unlocked session does not

## Storage
- [ ] Adapter reports `chrome` (see `StorageService.getAdapterType()`)
- [ ] No wallet data written to `localStorage` in extension mode

## Store upload
- Upload `dist-extension.zip` only after security review (Phase 2 + audit).

## Known blocker: PoW under extension CSP (must fix before shipping)
The MV3 extension-page CSP allows `'wasm-unsafe-eval'` (WASM compilation) but NOT
`'unsafe-eval'` (JS `eval` / `new Function`) — and Chrome forbids relaxing the
extension-page CSP with `'unsafe-eval'`. The SDK's PoW module
(`znn-typescript-sdk/dist/browser/pow.js`) is emscripten+embind compiled and calls
`new Function` **during module init** (verified: 2 calls before `generate()` is even
invoked). This is true on BOTH the worker and main-thread paths, since both inherit
the extension-page CSP — so disabling the worker (`src/core/zenon-service.ts`) does
not avoid it. Net effect: any transaction that requires PoW fails in the extension
with an `EvalError` (refused to evaluate a string as JavaScript).

Remediation (designed, NOT yet implemented — needs Chrome verification): run PoW in
a manifest-declared **sandbox page** (`content_security_policy.sandbox` may include
`'unsafe-eval'`), loaded as a hidden iframe, and register a custom
`Zenon.setPowProvider(...)` that proxies `(hashHex, difficulty) => Promise<nonce>`
to the sandbox via `postMessage`. See the Phase 1 plan, "Task 8: Sandboxed PoW
execution page".

## Known limitations
- Off-thread PoW worker is disabled under the extension CSP (`blob:` workers are
  forbidden). See `src/core/zenon-service.ts`.

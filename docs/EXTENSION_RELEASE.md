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
- [ ] Send a small testnet transaction — **KEY PoW VERIFICATION.** Exercises the sandbox PoW path (see "PoW under extension CSP" below). Confirm no `EvalError` in the `pow-sandbox.html` context and the block is published.
- [ ] Receive address shows
- [ ] Switch network / node
- [ ] Reload popup → no route 404 (hash routing)
- [ ] Restart browser → encrypted wallet persists, unlocked session does not

## Storage
- [ ] Adapter reports `chrome` (see `StorageService.getAdapterType()`)
- [ ] No wallet data written to `localStorage` in extension mode

## Store upload
- Upload `dist-extension.zip` only after security review (Phase 2 + audit).

## PoW under extension CSP (implemented; needs Chrome verification)
The MV3 extension-page CSP allows `'wasm-unsafe-eval'` (WASM compilation) but NOT
`'unsafe-eval'` (JS `eval` / `new Function`) — and Chrome forbids relaxing the
extension-page CSP with `'unsafe-eval'`. The SDK's PoW module
(`znn-typescript-sdk/dist/browser/pow.js`) is emscripten+embind compiled and calls
`new Function` **during module init** (verified: 2 calls before `generate()` is even
invoked). Both the worker and main-thread paths inherit the extension-page CSP, so
without a sandbox any PoW-requiring send fails with an `EvalError`.

**Implemented fix (Task 8):** PoW runs in a manifest-declared **sandbox page**
(`pow-sandbox.html`, `content_security_policy.sandbox` includes `'unsafe-eval'` +
`blob:`), loaded as a hidden iframe. `src/core/extension-pow-provider.ts` registers
a custom `Zenon.setPowProvider(...)` that fetches `pow.js`/`pow.wasm` on the
extension origin and proxies `(hashHex, difficulty) => Promise<nonce>` to the
sandbox via `postMessage`; the sandbox (`src/pow-sandbox.ts`) imports the pow.js
source as a Blob module and runs `generate`.

**Verified headlessly:** the build emits the sandbox page + assets; `createPowModule({wasmBinary})`
+ `generate()` produces a valid nonce in Node. **NOT yet verified in Chrome:** that the
sandbox CSP permits the Blob-module import + `new Function` and that the postMessage
round-trip works. The send smoke test above is the acceptance gate.

## Known limitations
- Off-thread PoW worker is disabled under the extension CSP (`blob:` workers are
  forbidden). See `src/core/zenon-service.ts`.

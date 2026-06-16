import type {PowProvider} from 'znn-typescript-sdk'

// Runs the SDK PoW module inside the manifest sandbox page (see
// src/pow-sandbox.ts) — the only context where its emscripten/embind
// `new Function` init is permitted under MV3 CSP. pow.js (source) and pow.wasm
// (bytes) are fetched here, on the extension origin, and handed to the sandbox
// so the opaque-origin sandbox never fetches a packaged resource itself.

// Generous ceiling for a single block's PoW (normally seconds). It only guards
// against a hung or killed sandbox, so a false timeout on real work is unlikely.
const POW_TIMEOUT_MS = 120_000
// The sandbox posts `pow-ready` right after its page loads; if it doesn't, its
// script was likely blocked (e.g. by CSP), so fail fast instead of hanging.
const SANDBOX_READY_TIMEOUT_MS = 10_000

const HEX = /^[0-9a-f]+$/i

type PowAssets = {powJsSource: string; wasmBinary: ArrayBuffer}
type Pending = {
  resolve: (nonce: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let frame: HTMLIFrameElement | null = null
let readyPromise: Promise<Window> | null = null
let assetsPromise: Promise<PowAssets> | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function settle(id: number, outcome: {nonce: string} | {error: Error}): void {
  const request = pending.get(id)
  if (!request) return
  clearTimeout(request.timer)
  pending.delete(id)
  if ('nonce' in outcome) request.resolve(outcome.nonce)
  else request.reject(outcome.error)
}

// Only trust result messages coming from our own sandbox iframe, and only accept
// a syntactically valid nonce — a stray/spoofed message must not mask a failure
// or submit a bogus nonce.
function onMessage(event: MessageEvent): void {
  if (!frame || event.source !== frame.contentWindow) return
  const data = event.data as {type?: string; id?: number; nonce?: unknown; message?: unknown}
  if (!data || typeof data.id !== 'number') return
  if (data.type === 'pow-result') {
    if (typeof data.nonce === 'string' && data.nonce.length > 0 && HEX.test(data.nonce)) {
      settle(data.id, {nonce: data.nonce})
    } else {
      settle(data.id, {error: new Error('PoW sandbox returned an invalid nonce')})
    }
  } else if (data.type === 'pow-error') {
    settle(data.id, {
      error: new Error(typeof data.message === 'string' ? data.message : 'PoW sandbox error'),
    })
  }
}

// Create the sandbox iframe and resolve once it signals `pow-ready`. Rejects (and
// resets, so a later call can retry) if the sandbox never reports ready.
function ensureReady(): Promise<Window> {
  if (readyPromise) return readyPromise
  readyPromise = new Promise<Window>((resolve, reject) => {
    if (typeof document === 'undefined') {
      readyPromise = null
      reject(new Error('PoW sandbox requires a document context'))
      return
    }
    const el = document.createElement('iframe')
    el.src = chrome.runtime.getURL('pow-sandbox.html')
    el.style.display = 'none'
    frame = el

    const timer = setTimeout(() => {
      window.removeEventListener('message', onReady)
      el.remove()
      frame = null
      readyPromise = null
      reject(new Error('PoW sandbox did not become ready in time'))
    }, SANDBOX_READY_TIMEOUT_MS)

    function onReady(event: MessageEvent): void {
      if (event.source !== el.contentWindow) return
      const data = event.data as {type?: string}
      if (!data || data.type !== 'pow-ready') return
      clearTimeout(timer)
      window.removeEventListener('message', onReady)
      window.addEventListener('message', onMessage)
      resolve(el.contentWindow as Window)
    }

    window.addEventListener('message', onReady)
    document.body.appendChild(el)
  })
  return readyPromise
}

async function fetchAsset(name: string): Promise<Response> {
  const res = await fetch(chrome.runtime.getURL(name))
  if (!res.ok) throw new Error(`Failed to load ${name}: ${res.status}`)
  return res
}

function loadAssets(): Promise<PowAssets> {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      fetchAsset('pow.js').then((res) => res.text()),
      fetchAsset('pow.wasm').then((res) => res.arrayBuffer()),
    ]).then(([powJsSource, wasmBinary]) => ({powJsSource, wasmBinary}))
  }
  return assetsPromise
}

/**
 * PoW provider (conforms to the SDK's `PowProvider`) that delegates generation
 * to the sandbox iframe. Install via `Zenon.setPowProvider` in extension mode.
 */
export const sandboxPowProvider: PowProvider = async (hashHex, difficulty) => {
  const [target, assets] = await Promise.all([ensureReady(), loadAssets()])
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('PoW sandbox timed out'))
    }, POW_TIMEOUT_MS)
    pending.set(id, {resolve, reject, timer})
    target.postMessage(
      {type: 'pow', id, hashHex, difficulty, powJsSource: assets.powJsSource, wasmBinary: assets.wasmBinary},
      '*'
    )
  })
}

import type {PowProvider} from 'znn-typescript-sdk'

// Runs the SDK PoW module inside the manifest sandbox page (see
// src/pow-sandbox.ts) — the only context where its emscripten/embind
// `new Function` init is permitted under MV3 CSP. pow.js (source) and pow.wasm
// (bytes) are fetched here, on the extension origin, and handed to the sandbox
// so the opaque-origin sandbox never fetches a packaged resource itself.

type PowAssets = {powJsSource: string; wasmBinary: ArrayBuffer}

let framePromise: Promise<Window> | null = null
let assetsPromise: Promise<PowAssets> | null = null
let nextId = 1
const pending = new Map<number, {resolve: (nonce: string) => void; reject: (err: Error) => void}>()

function onMessage(event: MessageEvent): void {
  const data = event.data as {type?: string; id?: number; nonce?: string; message?: string}
  if (!data || data.id == null) return
  const request = pending.get(data.id)
  if (!request) return
  if (data.type === 'pow-result') {
    pending.delete(data.id)
    request.resolve(data.nonce ?? '')
  } else if (data.type === 'pow-error') {
    pending.delete(data.id)
    request.reject(new Error(data.message ?? 'PoW sandbox error'))
  }
}

function ensureFrame(): Promise<Window> {
  if (framePromise) return framePromise
  framePromise = new Promise<Window>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('PoW sandbox requires a document context'))
      return
    }
    const frame = document.createElement('iframe')
    frame.src = chrome.runtime.getURL('pow-sandbox.html')
    frame.style.display = 'none'
    frame.addEventListener(
      'load',
      () =>
        frame.contentWindow
          ? resolve(frame.contentWindow)
          : reject(new Error('PoW sandbox iframe has no contentWindow')),
      {once: true}
    )
    window.addEventListener('message', onMessage)
    document.body.appendChild(frame)
  })
  return framePromise
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
  const [target, assets] = await Promise.all([ensureFrame(), loadAssets()])
  const id = nextId++
  return new Promise<string>((resolve, reject) => {
    pending.set(id, {resolve, reject})
    target.postMessage(
      {type: 'pow', id, hashHex, difficulty, powJsSource: assets.powJsSource, wasmBinary: assets.wasmBinary},
      '*'
    )
  })
}

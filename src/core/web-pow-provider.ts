import type { PowProvider } from 'znn-typescript-sdk'

/**
 * PoW for the web app in a dedicated worker loaded from /pow-worker.js. Unlike
 * the SDK's Blob worker, it doesn't inherit the page's CSP, so the server can
 * allow the 'unsafe-eval' the emscripten PoW module needs for that file alone.
 */
// Only a guard against a hung worker. A contract call without plasma needs PoW
// at difficulty 78.75M; single runs vary from seconds to several minutes on a
// desktop, and phones are slower.
const POW_TIMEOUT_MS = 20 * 60_000
const HEX = /^[0-9a-f]+$/i

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  {
    resolve: (nonce: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
>()

function failAll(error: Error): void {
  for (const [id, p] of pending) {
    clearTimeout(p.timer)
    p.reject(error)
    pending.delete(id)
  }
}

function getWorker(): Worker {
  if (worker) return worker
  const w = new Worker('/pow-worker.js', { type: 'module' })
  w.onmessage = (event: MessageEvent<{ id?: number; nonce?: string; error?: string }>) => {
    const { id, nonce, error } = event.data || {}
    const p = typeof id === 'number' ? pending.get(id) : undefined
    if (!p || id === undefined) return
    clearTimeout(p.timer)
    pending.delete(id)
    if (typeof nonce === 'string' && HEX.test(nonce)) p.resolve(nonce)
    else p.reject(new Error(`PoW failed: ${error ?? 'invalid result'}`))
  }
  w.onerror = (event) => {
    event.preventDefault()
    worker = null
    w.terminate()
    failAll(new Error(`PoW worker error: ${event.message || 'failed to load'}`))
  }
  worker = w
  return w
}

export const webPowProvider: PowProvider = (hashHex, difficulty) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => {
      // generate() is synchronous in the worker: a stuck job would block every
      // later one, so drop the worker (the next request starts a fresh one).
      worker?.terminate()
      worker = null
      failAll(new Error('PoW timed out'))
    }, POW_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      getWorker().postMessage({ id, hashHex, difficulty })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

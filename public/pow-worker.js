// Dedicated PoW worker for the web app (served as a real file, not a Blob).
//
// The SDK's PoW module is emscripten/embind code that needs `new Function` at
// init, i.e. CSP 'unsafe-eval'. A worker loaded from its own URL gets the CSP
// of its own HTTP response, so the server can allow 'unsafe-eval' for this
// file only (see nginx.conf.example) while the wallet page keeps a strict CSP.
// Protocol, like the SDK's PowWorker: {id, hashHex, difficulty} -> {id, nonce} | {id, error}.

let modulePromise = null

function getModule() {
  if (!modulePromise) {
    modulePromise = import('/pow.js').then((imported) =>
      imported.default({ locateFile: (path) => new URL('/' + path, self.location.origin).href })
    )
    modulePromise.catch(() => {
      modulePromise = null
    })
  }
  return modulePromise
}

self.onmessage = async (event) => {
  const { id, hashHex, difficulty } = event.data || {}
  try {
    if (typeof id !== 'number' || typeof hashHex !== 'string' || typeof difficulty !== 'number') {
      throw new Error('Invalid PoW request')
    }
    const pow = await getModule()
    self.postMessage({ id, nonce: pow.generate(hashHex, difficulty) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

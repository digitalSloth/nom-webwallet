// Runs inside the manifest-declared sandbox page (opaque origin). The SDK PoW
// module is emscripten/embind code that calls `new Function` at init, which the
// normal MV3 extension-page CSP forbids — so PoW runs here, where the sandbox
// CSP permits 'unsafe-eval'. The SDK does not expose pow.js as a package export
// (it's a runtime asset), so the parent page fetches its source text + the wasm
// bytes on the extension origin and passes them in; we import the source as a
// Blob module. Message protocol mirrors the SDK's PowWorker:
// {id, hashHex, difficulty} -> {id, nonce}.

type PowModule = {generate: (hashHex: string, difficulty: number) => string}
type CreatePowModule = (options: {wasmBinary: ArrayBuffer}) => Promise<PowModule>

type PowRequest = {
  type?: string
  id?: number
  hashHex?: string
  difficulty?: number
  powJsSource?: string
  wasmBinary?: ArrayBuffer
}

let modulePromise: Promise<PowModule> | null = null

function getModule(powJsSource: string, wasmBinary: ArrayBuffer): Promise<PowModule> {
  if (!modulePromise) {
    const blobUrl = URL.createObjectURL(new Blob([powJsSource], {type: 'text/javascript'}))
    modulePromise = import(/* @vite-ignore */ blobUrl)
      .then((imported) => {
        URL.revokeObjectURL(blobUrl)
        const createPowModule = imported.default as CreatePowModule
        return createPowModule({wasmBinary})
      })
      .catch((error) => {
        URL.revokeObjectURL(blobUrl)
        modulePromise = null
        throw error
      })
  }
  return modulePromise
}

window.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data as PowRequest
  if (!data || data.type !== 'pow' || data.id == null) return

  const reply = (message: Record<string, unknown>) =>
    (event.source as Window | null)?.postMessage(message, {targetOrigin: event.origin})

  try {
    const module = await getModule(data.powJsSource as string, data.wasmBinary as ArrayBuffer)
    const nonce = module.generate(data.hashHex as string, data.difficulty as number)
    reply({type: 'pow-result', id: data.id, nonce})
  } catch (error) {
    reply({
      type: 'pow-error',
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

// Tell the parent the message listener is live (and that this sandbox script
// wasn't blocked by CSP). The parent waits for this before sending requests.
window.parent.postMessage({type: 'pow-ready'}, '*')

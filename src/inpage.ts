import type {
  InpageEventMessage,
  InpageRequestMessage,
  InpageResponseMessage,
  ProviderError,
  ProviderEventName,
  PromptingMethod,
  ReadOnlyMethod,
} from '@/core/inpage-protocol'

/**
 * Runs in the MAIN world at document_start, on every frame. Defines
 * `window.zenon` and talks to content-script.ts over window.postMessage,
 * correlating replies by request id (§6.1, §6.3). Read-only methods have a
 * 30s timeout; prompting methods have none — the user may take arbitrarily
 * long, and their terminal failure path is the twice-unknown rule in
 * content-script.ts, not a timer.
 *
 * Deliberately duplicates the wire-protocol string constants below rather
 * than importing them as values from inpage-protocol.ts — see the matching
 * note in content-script.ts. This file must stay a self-contained IIFE with
 * no shared chunk, or crxjs wraps it in a dynamic-import loader subject to
 * the visited page's CSP (§5.1).
 */
const TARGET_CONTENT_SCRIPT = 'znn-contentscript'
const TARGET_INPAGE = 'znn-inpage'
const ZNN_ACCOUNTS = 'znn_accounts'
const ZNN_CHAIN_ID = 'znn_chainId'
const ZNN_NODE_URL = 'znn_nodeUrl'
const ZNN_DISCONNECT = 'znn_disconnect'
const ZNN_CONNECT = 'znn_connect'
const ZNN_SIGN = 'znn_sign'
const ZNN_SEND_TRANSACTION = 'znn_sendTransaction'
const ZNN_SIGN_AND_SEND_BLOCK = 'znn_signAndSendBlock'

const READ_ONLY_TIMEOUT_MS = 30_000

type EventListener = (data: unknown) => void

const listeners = new Map<ProviderEventName, Set<EventListener>>()

function emit(name: ProviderEventName, data: unknown): void {
  for (const listener of listeners.get(name) ?? []) {
    try {
      listener(data)
    } catch (err) {
      console.error('window.zenon listener threw', err)
    }
  }
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: ProviderError) => void
  timer?: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingCall>()
let nextId = 0

/** `timeoutMs: null` means no deadline — used for the four prompting methods. */
function call(
  method: ReadOnlyMethod | PromptingMethod,
  params: unknown,
  timeoutMs: number | null
): Promise<unknown> {
  const id = `${Date.now()}-${nextId++}`

  return new Promise((resolve, reject) => {
    const entry: PendingCall = { resolve, reject }
    if (timeoutMs !== null) {
      entry.timer = setTimeout(() => {
        pending.delete(id)
        reject({ code: -32603, message: `Timed out waiting for ${method}.` })
      }, timeoutMs)
    }

    pending.set(id, entry)
    const request: InpageRequestMessage = { target: TARGET_CONTENT_SCRIPT, id, method, params }
    window.postMessage(request, '*')
  })
}

function isResponse(data: unknown): data is InpageResponseMessage {
  const d = data as Partial<InpageResponseMessage> | undefined
  return !!d && d.target === TARGET_INPAGE && typeof d.id === 'string'
}

function isEvent(data: unknown): data is InpageEventMessage {
  const d = data as Partial<InpageEventMessage> | undefined
  return !!d && d.target === TARGET_INPAGE && d.kind === 'event' && typeof d.name === 'string'
}

window.addEventListener('message', (event: MessageEvent) => {
  // Both ends of the postMessage bridge must filter on event.source — without
  // it a child frame could forge a result into this page's pending promise
  // (§6.3, edge case 20).
  if (event.source !== window) return

  if (isEvent(event.data)) {
    emit(event.data.name, event.data.data)
    return
  }

  if (!isResponse(event.data)) return
  const entry = pending.get(event.data.id)
  if (!entry) return

  pending.delete(event.data.id)
  clearTimeout(entry.timer)
  if (event.data.error) entry.reject(event.data.error)
  else entry.resolve(event.data.result)
})

interface SignMessageResult {
  message: string
  address: string
  publicKey: string
  signature: string
}

interface SendTransactionParams {
  to: string
  tokenStandard: string
  amount: string | number
}

const zenon = {
  async getAccounts(): Promise<string[]> {
    return (await call(ZNN_ACCOUNTS, undefined, READ_ONLY_TIMEOUT_MS)) as string[]
  },

  async getChainId(): Promise<number> {
    return (await call(ZNN_CHAIN_ID, undefined, READ_ONLY_TIMEOUT_MS)) as number
  },

  async getNodeUrl(): Promise<string> {
    return (await call(ZNN_NODE_URL, undefined, READ_ONLY_TIMEOUT_MS)) as string
  },

  async disconnect(): Promise<void> {
    await call(ZNN_DISCONNECT, undefined, READ_ONLY_TIMEOUT_MS)
  },

  async connect(): Promise<string> {
    return (await call(ZNN_CONNECT, undefined, null)) as string
  },

  async signMessage(message: string): Promise<SignMessageResult> {
    return (await call(ZNN_SIGN, message, null)) as SignMessageResult
  },

  /** amount is in the token's smallest unit. Result: the published block hash (hex). */
  async sendTransaction(params: SendTransactionParams): Promise<string> {
    return (await call(ZNN_SEND_TRANSACTION, params, null)) as string
  },

  /** Result: the published block, as JSON. */
  async sendAccountBlock(block: unknown): Promise<unknown> {
    return await call(ZNN_SIGN_AND_SEND_BLOCK, block, null)
  },

  on(event: ProviderEventName, listener: EventListener): void {
    const set = listeners.get(event) ?? new Set()
    set.add(listener)
    listeners.set(event, set)
  },

  removeListener(event: ProviderEventName, listener: EventListener): void {
    listeners.get(event)?.delete(listener)
  },
}

// Defined at document_start, non-configurable and non-writable, so no later
// page script can shadow it (§6.9, edge case 41).
Object.defineProperty(window, 'zenon', {
  value: zenon,
  writable: false,
  configurable: false,
})

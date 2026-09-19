import { computed, shallowRef, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import type { SessionTypes, SignClientTypes } from '@walletconnect/types'
import { WalletService } from './wallet-service'
import { ZenonService } from './zenon-service'
import { messageProblem } from './message-guard'
import { accountBlockProblem } from './account-block-validation'
import { InvalidParamsError, parseAccountBlockJson } from './account-block-params'
import { approvalQueue, enqueueApproval, type WalletRejection } from './dapp-approvals'
import type { IWalletConnectClient, OutgoingError } from './walletconnect-client'

/**
 * Orchestration for the WalletConnect surface — the interop contract (§2.1 in
 * the design), enqueued through the shared approval queue (dapp-approvals.ts)
 * and rendered by the one dialog component. `sessions` is module-level state
 * fed by the client's event handlers, following dapp-approvals.ts's own
 * pattern: only this module receives those events, so it is the owner.
 */

const ZENON_NAMESPACE = 'zenon'
const ZENON_CHAIN = 'zenon:1'
const SUPPORTED_METHODS = ['znn_info', 'znn_sign', 'znn_send']
const SUPPORTED_EVENTS = ['chainIdChange', 'addressChange']

const WALLET_LOCKED_ERROR: OutgoingError = { kind: 'literal', code: 9000, message: 'Wallet is locked' }

function invalidParamsError(message: string): OutgoingError {
  return { kind: 'literal', code: -32602, message }
}

function tooManyRequestsError(): OutgoingError {
  return { kind: 'literal', code: -32005, message: 'Too many pending requests' }
}

function sendFailedError(message: string): OutgoingError {
  return { kind: 'literal', code: -32603, message }
}

function toOutgoingError(rejection: WalletRejection): OutgoingError {
  switch (rejection.reason) {
    case 'userRejected':
      return { kind: 'protocol', rejection: 'USER_REJECTED' }
    case 'walletLocked':
      return WALLET_LOCKED_ERROR
    case 'invalidParams':
      return invalidParamsError(rejection.detail)
    case 'unsupportedMethod':
      return { kind: 'protocol', rejection: 'UNSUPPORTED_METHOD' }
    case 'tooManyRequests':
      return tooManyRequestsError()
    case 'sendFailed':
      return sendFailedError(rejection.detail)
    case 'notConnected':
      // Not reachable on this surface — a session is the connection (§4).
      return invalidParamsError('No active session.')
  }
}

/** Canonical form is a bare string; also accepts `["msg"]` and `{message: "…"}`. */
function parseSignParams(params: unknown): string | null {
  if (typeof params === 'string') return params
  if (Array.isArray(params) && params.length === 1 && typeof params[0] === 'string') {
    return params[0]
  }
  if (params && typeof params === 'object' && typeof (params as Record<string, unknown>).message === 'string') {
    return (params as Record<string, unknown>).message as string
  }
  return null
}

/** Canonical form is {accountBlock, fromAddress}; also accepts a single-element array. */
function parseSendParams(params: unknown): { accountBlock: unknown; fromAddress: unknown } | null {
  const candidate = Array.isArray(params) && params.length === 1 ? params[0] : params
  if (
    candidate &&
    typeof candidate === 'object' &&
    'accountBlock' in candidate &&
    'fromAddress' in candidate
  ) {
    const c = candidate as Record<string, unknown>
    return { accountBlock: c.accountBlock, fromAddress: c.fromAddress }
  }
  return null
}

const sessions = shallowRef<SessionTypes.Struct[]>([])
/** Read-only reactive view for useWalletConnect. */
export const walletConnectSessions = computed(() => sessions.value)

export class WalletConnectService {
  private static instance: WalletConnectService | null = null

  static getInstance(): WalletConnectService {
    if (!WalletConnectService.instance) {
      WalletConnectService.instance = new WalletConnectService()
    }
    return WalletConnectService.instance
  }

  private client: IWalletConnectClient | null = null
  private initPromise: Promise<void> | null = null
  private badgeWatcherStarted = false

  // The client is not a defaulted constructor argument: a default would be a
  // static import of the adapter, which statically imports the SDK, putting the
  // whole WalletConnect dependency graph into the main chunk of every page
  // context — including the approval window and the action popup.
  initialize(client?: IWalletConnectClient): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const impl =
        client ?? new (await import('./walletconnect-sign-client-adapter')).SignClientAdapter()
      this.client = impl

      await impl.init({
        onProposal: (p) => void this.handleProposal(p),
        onRequest: (r) => void this.handleRequest(r),
        onSessionsChanged: (list) => {
          sessions.value = list
        },
      })

      this.startBadgeWatcher()
    })()

    return this.initPromise
  }

  private requireClient(): IWalletConnectClient {
    if (!this.client) throw new Error('WalletConnect client is not initialized.')
    return this.client
  }

  async pair(uri: string): Promise<void> {
    await this.requireClient().pair(uri)
  }

  async disconnect(topic: string): Promise<void> {
    await this.requireClient().disconnect(topic)
    sessions.value = sessions.value.filter((s) => s.topic !== topic)
  }

  /** §2.3 item 4 — account-switch broadcast, driven by useWalletConnect's watcher. */
  async setActiveAccount(address: string): Promise<void> {
    if (!this.client) return
    for (const session of this.client.listSessions()) {
      await this.client.updateSessionAccounts(session.topic, [`${ZENON_CHAIN}:${address}`])
      await this.client.emit(session.topic, { name: 'addressChange', data: address })
    }
  }

  /** §2.3 item 4 — chain-change broadcast, driven by useWalletConnect's watcher. */
  async emitChainIdChange(chainId: number): Promise<void> {
    if (!this.client) return
    for (const session of this.client.listSessions()) {
      await this.client.emit(session.topic, { name: 'chainIdChange', data: chainId })
    }
  }

  private getPeer(topic: string): { name: string; url: string; icons: string[] } {
    const session = this.requireClient()
      .listSessions()
      .find((s) => s.topic === topic)
    const metadata = session?.peer.metadata
    return {
      name: metadata?.name ?? 'Unknown dApp',
      url: metadata?.url ?? '',
      icons: metadata?.icons ?? [],
    }
  }

  private async handleProposal(
    p: SignClientTypes.EventArguments['session_proposal']
  ): Promise<void> {
    const client = this.requireClient()
    const required = p.params.requiredNamespaces

    for (const key of Object.keys(required)) {
      if (key !== ZENON_NAMESPACE) {
        await client.rejectProposal(p.id, { kind: 'protocol', rejection: 'UNSUPPORTED_NAMESPACE_KEY' })
        return
      }
    }

    const zenonNamespace = required[ZENON_NAMESPACE]
    if (zenonNamespace) {
      const chains = zenonNamespace.chains ?? []
      if (chains.some((chain) => chain !== ZENON_CHAIN)) {
        await client.rejectProposal(p.id, { kind: 'protocol', rejection: 'UNSUPPORTED_CHAINS' })
        return
      }
      if (zenonNamespace.methods.some((method) => !SUPPORTED_METHODS.includes(method))) {
        await client.rejectProposal(p.id, { kind: 'protocol', rejection: 'UNSUPPORTED_METHODS' })
        return
      }
    }

    const activeAddress = await WalletService.getInstance().getActiveAccount()
    if (!activeAddress) {
      await client.rejectProposal(p.id, { kind: 'protocol', rejection: 'USER_REJECTED' })
      toast.error('A wallet must be created before a dApp can connect.')
      return
    }

    const proposer = p.params.proposer.metadata
    const enqueued = enqueueApproval(
      {
        id: `wc:proposal:${p.id}`,
        surface: 'walletconnect',
        origin: proposer.url,
        peer: { name: proposer.name, url: proposer.url, icons: proposer.icons },
        createdAt: Date.now(),
        action: { kind: 'connect' },
      },
      {
        resolve: async (result) => {
          if (result.kind !== 'connect') return
          await client.approveProposal(p.id, {
            [ZENON_NAMESPACE]: {
              chains: [ZENON_CHAIN],
              methods: SUPPORTED_METHODS,
              events: SUPPORTED_EVENTS,
              accounts: [`${ZENON_CHAIN}:${result.address}`],
            },
          })
          // Don't wait on the SDK's session_connect event for this — it's
          // emitted from onSessionSettleRequest, which is the handler for
          // *receiving* a settle request (the dApp's role), not guaranteed to
          // fire for the wallet that just sent it. approveProposal() already
          // awaited full settlement, so the new session is in the SDK's own
          // store now; read it directly instead of waiting on an event that
          // may never come on this side.
          sessions.value = client.listSessions()
        },
        reject: async () => {
          await client.rejectProposal(p.id, { kind: 'protocol', rejection: 'USER_REJECTED' })
        },
      }
    )

    if (!enqueued) {
      await client.rejectProposal(p.id, tooManyRequestsError())
      return
    }
    await this.grabAttention()
  }

  private async handleRequest(
    r: SignClientTypes.EventArguments['session_request']
  ): Promise<void> {
    const client = this.requireClient()
    const { topic, id: rpcId } = r
    const { method, params } = r.params.request

    if (method === 'znn_info') {
      await this.respondInfo(client, topic, rpcId)
      return
    }

    if (method === 'znn_sign') {
      await this.handleSign(client, topic, rpcId, params)
      return
    }

    if (method === 'znn_send') {
      await this.handleSend(client, topic, rpcId, params)
      return
    }

    await client.respondError(topic, rpcId, { kind: 'protocol', rejection: 'UNSUPPORTED_METHOD' })
  }

  private async respondInfo(client: IWalletConnectClient, topic: string, rpcId: number): Promise<void> {
    const address = await WalletService.getInstance().getActiveAccount()
    if (!address) {
      await client.respondError(topic, rpcId, WALLET_LOCKED_ERROR)
      return
    }

    const zenonService = ZenonService.getInstance()
    await client.respond(topic, rpcId, {
      address,
      nodeUrl: zenonService.getNodeUrl(),
      chainId: zenonService.getChainId(),
    })
  }

  private async handleSign(
    client: IWalletConnectClient,
    topic: string,
    rpcId: number,
    rawParams: unknown
  ): Promise<void> {
    const message = parseSignParams(rawParams)
    if (message === null) {
      await client.respondError(topic, rpcId, invalidParamsError('Malformed znn_sign params.'))
      return
    }

    const problem = messageProblem(message)
    if (problem) {
      await client.respondError(topic, rpcId, invalidParamsError(problem))
      return
    }

    const peer = this.getPeer(topic)
    const enqueued = enqueueApproval(
      {
        id: `wc:${topic}:${rpcId}`,
        surface: 'walletconnect',
        origin: peer.url,
        peer,
        createdAt: Date.now(),
        action: { kind: 'signMessage', message },
      },
      {
        resolve: async (result) => {
          if (result.kind !== 'signMessage') return
          await client.respond(topic, rpcId, {
            signature: result.signature,
            publicKey: result.publicKey,
          })
        },
        reject: async (reason) => {
          await client.respondError(topic, rpcId, toOutgoingError(reason))
        },
      }
    )

    if (!enqueued) {
      await client.respondError(topic, rpcId, tooManyRequestsError())
      return
    }
    await this.grabAttention()
  }

  private async handleSend(
    client: IWalletConnectClient,
    topic: string,
    rpcId: number,
    rawParams: unknown
  ): Promise<void> {
    const parsed = parseSendParams(rawParams)
    if (!parsed) {
      await client.respondError(topic, rpcId, invalidParamsError('Malformed znn_send params.'))
      return
    }

    const activeAddress = await WalletService.getInstance().getActiveAccount()
    if (!activeAddress) {
      await client.respondError(topic, rpcId, WALLET_LOCKED_ERROR)
      return
    }
    if (parsed.fromAddress !== activeAddress) {
      // The wallet, never the dApp, decides which key signs — a fromAddress
      // that isn't the active account is refused here, before any dialog.
      await client.respondError(topic, rpcId, invalidParamsError('fromAddress is not the active account.'))
      return
    }

    const problem = accountBlockProblem(parsed.accountBlock)
    if (problem) {
      await client.respondError(topic, rpcId, invalidParamsError(problem))
      return
    }

    let block: AccountBlockTemplate
    try {
      await ZenonService.getInstance().ensureInitialized()
      block = parseAccountBlockJson(parsed.accountBlock)
    } catch (err) {
      const message = err instanceof InvalidParamsError ? err.message : 'Invalid account block.'
      await client.respondError(topic, rpcId, invalidParamsError(message))
      return
    }

    const peer = this.getPeer(topic)
    const enqueued = enqueueApproval(
      {
        id: `wc:${topic}:${rpcId}`,
        surface: 'walletconnect',
        origin: peer.url,
        peer,
        createdAt: Date.now(),
        action: { kind: 'sendBlock', block },
      },
      {
        resolve: async (result) => {
          if (result.kind !== 'sendBlock') return
          await client.respond(topic, rpcId, result.block.toJson())
        },
        reject: async (reason) => {
          await client.respondError(topic, rpcId, toOutgoingError(reason))
        },
      }
    )

    if (!enqueued) {
      await client.respondError(topic, rpcId, tooManyRequestsError())
      return
    }
    await this.grabAttention()
  }

  /**
   * §2.3 item 5. Extension only: raises the WalletConnect tab and its window so
   * an approval never opens somewhere the user can't see it, and sets the
   * badge so a background tab still signals a waiting request.
   */
  private async grabAttention(): Promise<void> {
    if (!__IS_EXTENSION__) return

    await chrome.action.setBadgeText({ text: String(listWalletConnectApprovals()) })
    const self = await chrome.tabs.getCurrent()
    if (self?.id) await chrome.tabs.update(self.id, { active: true })
    if (self?.windowId) await chrome.windows.update(self.windowId, { focused: true })
  }

  private startBadgeWatcher(): void {
    if (!__IS_EXTENSION__ || this.badgeWatcherStarted) return
    this.badgeWatcherStarted = true

    watch(approvalQueue, (list) => {
      if (list.filter((a) => a.surface === 'walletconnect').length === 0) {
        void chrome.action.setBadgeText({ text: '' })
      }
    })
  }
}

function listWalletConnectApprovals(): number {
  return approvalQueue.value.filter((a) => a.surface === 'walletconnect').length
}

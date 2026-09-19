import SignClient from '@walletconnect/sign-client'
import { getSdkError, type SdkErrorKey } from '@walletconnect/utils'
import type { SessionTypes } from '@walletconnect/types'
import { WALLETCONNECT_METADATA, WALLETCONNECT_PROJECT_ID } from '@/config'
import { WalletConnectStorage } from './storage/walletconnect-storage'
import type {
  IWalletConnectClient,
  OutgoingError,
  ProtocolRejection,
  WalletConnectClientHandlers,
} from './walletconnect-client'

/**
 * The only file with a runtime import of `@walletconnect/sign-client`,
 * `@walletconnect/utils` or `@walletconnect/core`. If the licence terms become
 * unacceptable, a fork appears, or a different relay is adopted, this file is
 * replaced and nothing else changes.
 */

const PROTOCOL_REJECTION_TO_SDK_KEY: Record<ProtocolRejection, SdkErrorKey> = {
  USER_REJECTED: 'USER_REJECTED',
  UNSUPPORTED_CHAINS: 'UNSUPPORTED_CHAINS',
  UNSUPPORTED_METHODS: 'UNSUPPORTED_METHODS',
  UNSUPPORTED_NAMESPACE_KEY: 'UNSUPPORTED_NAMESPACE_KEY',
  UNSUPPORTED_METHOD: 'WC_METHOD_UNSUPPORTED',
}

function toSdkError(error: OutgoingError): { code: number; message: string } {
  if (error.kind === 'protocol') {
    return getSdkError(PROTOCOL_REJECTION_TO_SDK_KEY[error.rejection])
  }
  return { code: error.code, message: error.message }
}

// zenon:1 is the only chain this wallet ever proposes or accepts (§2.1), so it
// is the one value every emit() needs and no caller of IWalletConnectClient
// should have to repeat.
const ZENON_CHAIN_ID = 'zenon:1'

export class SignClientAdapter implements IWalletConnectClient {
  private client: SignClient | null = null
  private initPromise: Promise<void> | null = null

  init(handlers: WalletConnectClientHandlers): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      const client = await SignClient.init({
        projectId: WALLETCONNECT_PROJECT_ID,
        metadata: WALLETCONNECT_METADATA,
        storage: new WalletConnectStorage(),
      })

      client.on('session_proposal', (proposal) => handlers.onProposal(proposal))
      client.on('session_request', (request) => handlers.onRequest(request))
      client.on('session_delete', () => handlers.onSessionsChanged(client.session.getAll()))
      client.on('session_update', () => handlers.onSessionsChanged(client.session.getAll()))
      // Fires when a session finishes settling after approve() — session_update
      // is only for namespace changes on an *existing* session, so without this
      // a newly approved session never appears until something else happens to
      // refresh the list (e.g. reopening the window).
      client.on('session_connect', () => handlers.onSessionsChanged(client.session.getAll()))

      this.client = client
      handlers.onSessionsChanged(client.session.getAll())
    })()

    return this.initPromise
  }

  private requireClient(): SignClient {
    if (!this.client) throw new Error('WalletConnect client is not initialized.')
    return this.client
  }

  async pair(uri: string): Promise<void> {
    await this.requireClient().pair({ uri })
  }

  listSessions(): SessionTypes.Struct[] {
    return this.requireClient().session.getAll()
  }

  async approveProposal(id: number, namespaces: SessionTypes.Namespaces): Promise<void> {
    const { acknowledged } = await this.requireClient().approve({ id, namespaces })
    await acknowledged()
  }

  async rejectProposal(id: number, error: OutgoingError): Promise<void> {
    await this.requireClient().reject({ id, reason: toSdkError(error) })
  }

  async respond(topic: string, rpcId: number, result: unknown): Promise<void> {
    await this.requireClient().respond({
      topic,
      response: { id: rpcId, jsonrpc: '2.0', result },
    })
  }

  async respondError(topic: string, rpcId: number, error: OutgoingError): Promise<void> {
    await this.requireClient().respond({
      topic,
      response: { id: rpcId, jsonrpc: '2.0', error: toSdkError(error) },
    })
  }

  async updateSessionAccounts(topic: string, accounts: string[]): Promise<void> {
    const client = this.requireClient()
    const session = client.session.get(topic)
    const namespaces: SessionTypes.Namespaces = Object.fromEntries(
      Object.entries(session.namespaces).map(([key, namespace]) => [
        key,
        { ...namespace, accounts },
      ])
    )
    const { acknowledged } = await client.update({ topic, namespaces })
    await acknowledged()
  }

  async emit(topic: string, event: { name: string; data: unknown }): Promise<void> {
    await this.requireClient().emit({ topic, event, chainId: ZENON_CHAIN_ID })
  }

  async disconnect(topic: string): Promise<void> {
    await this.requireClient().disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  }

  async destroy(): Promise<void> {
    this.client = null
    this.initPromise = null
  }
}

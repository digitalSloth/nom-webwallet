import type { SessionTypes, SignClientTypes } from '@walletconnect/types'

/**
 * The vendor seam: one interface, one adapter (`walletconnect-sign-client-adapter.ts`)
 * construct and call `@walletconnect/sign-client`. Everything else — session, approval
 * and signing logic — talks to this interface only, so a licence change or a different
 * relay needs a new adapter and nothing else.
 */

/** Semantic rejection reasons. The adapter maps these to the vendor's error registry. */
export type ProtocolRejection =
  | 'USER_REJECTED'
  | 'UNSUPPORTED_CHAINS'
  | 'UNSUPPORTED_METHODS'
  | 'UNSUPPORTED_NAMESPACE_KEY'
  | 'UNSUPPORTED_METHOD'

export type OutgoingError =
  | { kind: 'protocol'; rejection: ProtocolRejection }
  | { kind: 'literal'; code: number; message: string }

export interface WalletConnectClientHandlers {
  onProposal(p: SignClientTypes.EventArguments['session_proposal']): void
  onRequest(r: SignClientTypes.EventArguments['session_request']): void
  onSessionsChanged(s: SessionTypes.Struct[]): void
}

export interface IWalletConnectClient {
  init(handlers: WalletConnectClientHandlers): Promise<void>
  pair(uri: string): Promise<void>
  listSessions(): SessionTypes.Struct[]
  // Namespaces here, not ProposalTypes.RequiredNamespaces: the approved namespace
  // carries `accounts` (SessionTypes.Namespace), which a required namespace doesn't.
  approveProposal(id: number, namespaces: SessionTypes.Namespaces): Promise<void>
  rejectProposal(id: number, error: OutgoingError): Promise<void>
  respond(topic: string, rpcId: number, result: unknown): Promise<void>
  respondError(topic: string, rpcId: number, error: OutgoingError): Promise<void>
  updateSessionAccounts(topic: string, accounts: string[]): Promise<void>
  emit(topic: string, event: { name: string; data: unknown }): Promise<void>
  disconnect(topic: string): Promise<void>
  destroy(): Promise<void>
}

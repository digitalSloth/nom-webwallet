import {
  AccountBlock,
  AccountBlockTemplate,
  Address,
  Hash,
  KeyPair,
  TokenStandard,
} from 'znn-typescript-sdk'
import { isKnownRefusalMessage } from './node-refusal-messages'
import { ChainService } from './chain-service'
import { createSerialQueue } from './serial-queue'
import { getSendRecorder } from './send-recorder'
import type { SendContext, SendRecording } from './send-recorder'
import { holdSendLock, sendContext, sendPhase } from './send-status'
import { withTimeout } from './with-timeout'
import { SEND_ABANDONED_DEADLINE_MS, SEND_TIMEOUT_MS } from '@/config'

export const SEND_TIMEOUT_MESSAGE =
  'The outcome is unknown: the node did not respond in time and this transaction may still go through. Check your account history before sending again.'

/**
 * JSON-RPC codes a node returns when it refuses a request: -32000 is the
 * server's code for an error raised by the method itself (go-zenon verifier
 * refusals); -32600, -32601, -32602 and -32700 refuse the request before the
 * method runs. Excluded on purpose: -32603 (internal error, which can follow a
 * partly run method) and -32002 (handler timeout, the method may still run).
 * A -32000 counts only with a message from NODE_REFUSAL_MESSAGES. Any other
 * -32000 message is not a refusal: go-zenon sends "method handler crashed"
 * when a method panicked (rpc/server/service.go), which can follow the block
 * being inserted and broadcast, and a proxy can send its own text.
 */
export const NODE_REJECTION_CODES: ReadonlySet<number> = new Set([
  -32000, -32600, -32601, -32602, -32700,
])

/** True only for an object with a numeric `code` in NODE_REJECTION_CODES, with -32000 only for a known refusal message. */
export function isNodeRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { code, message } = err as { code?: unknown; message?: unknown }
  if (typeof code !== 'number' || !NODE_REJECTION_CODES.has(code)) return false
  return code !== -32000 || isKnownRefusalMessage(message)
}

export class PublishRejectedError extends Error {
  /** `reason` is the node's message; it is also `message`, so existing error displays read the same text. */
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'PublishRejectedError'
  }
}

/** Thrown for a send the page's suspension stopped before it reached publishing. */
export class SendSuspendedError extends Error {
  constructor() {
    super('The page was suspended before publishing. Nothing was sent.')
    this.name = 'SendSuspendedError'
  }
}

let suspensions = 0

/** Stops every send of this document that has not reached publishing yet. */
export function suspendPendingPublishes(): void {
  suspensions++
}

function rejectionReason(err: unknown): string {
  const message = (err as { message?: unknown }).message
  return typeof message === 'string' && message !== '' ? message : 'no reason given'
}

export class TransactionService extends ChainService {
  private static instance: TransactionService | null = null

  // Sends from one account must not overlap: two concurrent sends autofill the
  // same frontier and the second publish fails.
  private readonly sendQueue = createSerialQueue()

  static getInstance(): TransactionService {
    if (!TransactionService.instance) {
      TransactionService.instance = new TransactionService()
    }
    return TransactionService.instance
  }

  // Send a transaction
  async sendTransaction(
    recipientAddress: string,
    zts: string,
    amount: bigint,
    keyPair: KeyPair,
    context?: SendContext
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const recipient = Address.parse(recipientAddress)
    const tokenStandard = TokenStandard.parse(zts)
    const block = AccountBlockTemplate.send(recipient, tokenStandard, amount)

    return this.publish(block, keyPair, undefined, context)
  }

  // Receive a transaction
  async receiveTransaction(
    blockHash: string,
    keyPair: KeyPair,
    context?: SendContext,
    beforePublish?: () => unknown
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const hash = Hash.parse(blockHash)
    const receiveBlock = AccountBlockTemplate.receive(hash)

    return this.publish(receiveBlock, keyPair, beforePublish, context)
  }

  // Send an embedded contract block (for rewards, staking, etc).
  // `beforePublish` runs after PoW and signing, right before the block is
  // published. Throwing from it stops the publish. It also runs for an
  // attempt abandoned after the timeout, and an async gate is awaited.
  async sendEmbeddedContractBlock(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => unknown,
    context?: SendContext
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    return this.publish(block, keyPair, beforePublish, context)
  }

  // Read a block by hash. Bypasses the send queue and lock: reads never hold the overlay.
  async getAccountBlock(hash: string): Promise<AccountBlock | null> {
    await this.ensureInitialized()
    return this.zenon.ledger.getAccountBlockByHash(Hash.parse(hash))
  }

  // Queue a send behind earlier ones and bound it by SEND_TIMEOUT_MS, which
  // starts when the send leaves the queue. The timed-out send is not
  // cancelled, but it never touches `sendPhase` again. Its record stays,
  // with the heartbeat, until the send settles or SEND_ABANDONED_DEADLINE_MS
  // passes. A failure before the broadcast call, or a node refusal, removes the
  // record; any other failure detaches it, in time or late, and surfaces as
  // an unknown outcome. A late publish records
  // `publishing` and `published` and detaches the record, so the
  // interrupted-send check tracks and releases it like any published send.
  // At the deadline an attempt that has not reached publishing is cancelled
  // and its record removed; any other record is detached at its stage.
  // The recording starts before the queue, so a send waiting behind another
  // is on record too.
  private publish(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => unknown,
    context?: SendContext
  ): Promise<AccountBlockTemplate> {
    const suspendedAt = suspensions
    const recording = context ? getSendRecorder().begin(context) : null
    return holdSendLock(() =>
      this.sendQueue(async () => {
        const attempt = { live: true, publishing: false, cancelled: false, sent: false }
        let settled = false
        let timedOut = false
        let deadline: ReturnType<typeof setTimeout> | undefined
        const run = this.attempt(
          block,
          keyPair,
          beforePublish,
          recording,
          attempt,
          context,
          suspendedAt
        )
        run.then(
          () => {
            settled = true
            clearTimeout(deadline)
            if (timedOut) recording?.detach()
          },
          (err) => {
            settled = true
            clearTimeout(deadline)
            if (!timedOut) return
            // Past the broadcast call only a node refusal proves nothing was sent.
            if (attempt.sent && !(err instanceof PublishRejectedError)) recording?.detach()
            else recording?.abandon()
          }
        )
        try {
          return await withTimeout(run, SEND_TIMEOUT_MS, SEND_TIMEOUT_MESSAGE)
        } catch (err) {
          if (settled) {
            if (attempt.sent && !(err instanceof PublishRejectedError)) recording?.detach()
            else recording?.abandon()
          } else {
            timedOut = true
            deadline = setTimeout(() => {
              if (attempt.publishing) {
                recording?.detach()
              } else {
                attempt.cancelled = true
                recording?.abandon()
              }
            }, SEND_ABANDONED_DEADLINE_MS)
          }
          throw err
        } finally {
          attempt.live = false
          sendPhase.value = null
          sendContext.value = null
        }
      })
    )
  }

  private async attempt(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish: (() => unknown) | undefined,
    recording: SendRecording | null,
    attempt: { live: boolean; publishing: boolean; cancelled: boolean; sent: boolean },
    context: SendContext | undefined,
    suspendedAt: number
  ): Promise<AccountBlockTemplate> {
    if (attempt.live) {
      sendPhase.value = 'preparing'
      sendContext.value = context ?? null
    }
    await this.ensureInitialized()
    const prepared = await this.zenon.prepareBlock(block, keyPair)
    if (beforePublish) await beforePublish()
    if (suspensions !== suspendedAt) throw new SendSuspendedError()
    if (attempt.cancelled)
      throw new Error('The send was cancelled before publishing. Nothing was sent.')
    attempt.publishing = true
    const hash = recording ? prepared.hash.toString() : ''
    await recording?.publishing(hash)
    if (suspensions !== suspendedAt) throw new SendSuspendedError()
    if (attempt.live) sendPhase.value = 'publishing'
    let result: AccountBlockTemplate
    try {
      attempt.sent = true
      result = await this.zenon.ledger.publishRawTransaction(prepared)
    } catch (err) {
      if (isNodeRejection(err)) throw new PublishRejectedError(rejectionReason(err))
      // Past the broadcast call any other failure leaves the outcome unknown.
      throw Object.assign(new Error(SEND_TIMEOUT_MESSAGE), { cause: err })
    }
    recording?.published(hash)
    return result
  }
}

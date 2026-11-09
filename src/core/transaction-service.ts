import {
  AccountBlock,
  AccountBlockTemplate,
  Address,
  Hash,
  KeyPair,
  TokenStandard,
} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'
import {createSerialQueue} from './serial-queue'
import {holdSendLock} from './send-status'
import {withTimeout} from './with-timeout'
import {SEND_TIMEOUT_MS} from '@/config'

const SEND_TIMEOUT_MESSAGE =
  'The node did not respond in time. Check your account history before sending again, because this transaction may still go through.'

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
    keyPair: KeyPair
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const recipient = Address.parse(recipientAddress)
    const tokenStandard = TokenStandard.parse(zts)
    const block = AccountBlockTemplate.send(recipient, tokenStandard, amount)

    return this.publish(block, keyPair)
  }

  // Receive a transaction
  async receiveTransaction(blockHash: string, keyPair: KeyPair): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const hash = Hash.parse(blockHash)
    const receiveBlock = AccountBlockTemplate.receive(hash)

    return this.publish(receiveBlock, keyPair)
  }

  // Send an embedded contract block (for rewards, staking, etc).
  // `beforePublish` runs after PoW and signing, right before the block is
  // published. Throwing from it stops the publish.
  async sendEmbeddedContractBlock(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => void
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    return this.publish(block, keyPair, beforePublish)
  }

  // Read a block by hash. Bypasses the send queue and lock: reads never hold the overlay.
  async getAccountBlock(hash: string): Promise<AccountBlock | null> {
    await this.ensureInitialized()
    return this.zenon.ledger.getAccountBlockByHash(Hash.parse(hash))
  }

  // Queue a send behind earlier ones and bound it by SEND_TIMEOUT_MS, which
  // starts when the send leaves the queue. The abandoned send is not cancelled.
  private publish(
    block: AccountBlockTemplate,
    keyPair: KeyPair,
    beforePublish?: () => void
  ): Promise<AccountBlockTemplate> {
    return holdSendLock(() =>
      this.sendQueue(() =>
        withTimeout(
          (async () => {
            await this.ensureInitialized()
            const prepared = await this.zenon.prepareBlock(block, keyPair)
            beforePublish?.()
            return this.zenon.ledger.publishRawTransaction(prepared)
          })(),
          SEND_TIMEOUT_MS,
          SEND_TIMEOUT_MESSAGE
        )
      )
    )
  }
}

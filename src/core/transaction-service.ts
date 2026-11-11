import {AccountBlockTemplate, Address, Hash, KeyPair, TokenStandard,} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export class TransactionService extends ChainService {
  private static instance: TransactionService | null = null

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

    return await this.zenon.send(block, keyPair)
  }

  // Receive a transaction
  async receiveTransaction(blockHash: string, keyPair: KeyPair): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    const hash = Hash.parse(blockHash)
    const receiveBlock = AccountBlockTemplate.receive(hash)

    return await this.zenon.send(receiveBlock, keyPair)
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
    const prepared = await this.zenon.prepareBlock(block, keyPair)
    beforePublish?.()
    return await this.zenon.ledger.publishRawTransaction(prepared)
  }
}

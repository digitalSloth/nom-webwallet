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

  // Send an embedded contract block (for rewards, staking, etc)
  async sendEmbeddedContractBlock(
    block: AccountBlockTemplate,
    keyPair: KeyPair
  ): Promise<AccountBlockTemplate> {
    await this.ensureInitialized()
    return await this.zenon.send(block, keyPair)
  }
}

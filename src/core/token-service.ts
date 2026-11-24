import { Address, TokenStandard } from 'znn-typescript-sdk'
import type { AccountBlockTemplate, Token, TokenList } from 'znn-typescript-sdk'
import { TOKEN_ISSUE_FEE, TOKEN_OWNED_PAGE_SIZE } from '@/config'
import { ChainService } from './chain-service'

export interface IssueParams {
  name: string
  symbol: string
  domain: string // '' for none
  /** Raw base units. */
  totalSupply: bigint
  /** Raw base units. */
  maxSupply: bigint
  decimals: number
  mintable: boolean
  burnable: boolean
  utility: boolean
}

export interface MintParams {
  tokenStandard: string
  /** Raw base units. */
  amount: bigint
  receiveAddress: string
}

export interface BurnParams {
  tokenStandard: string
  /** Raw base units. */
  amount: bigint
}

export interface UpdateParams {
  tokenStandard: string
  owner: string
  mintable: boolean
  burnable: boolean
}

export class TokenService extends ChainService {
  private static instance: TokenService | null = null

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService()
    }
    return TokenService.instance
  }

  // Get token information by ZTS
  async getTokenByZts(tokenStandard: string): Promise<Token | null> {
    await this.ensureInitialized()
    try {
      const zts = TokenStandard.parse(tokenStandard)
      return await this.zenon.embedded.token.getByZts(zts)
    } catch (error) {
      console.error('Failed to get token info:', error)
      return null
    }
  }

  // Tokens issued by an address
  async getByOwner(
    address: string,
    pageIndex: number = 0,
    pageSize: number = TOKEN_OWNED_PAGE_SIZE
  ): Promise<TokenList> {
    await this.ensureInitialized()
    return this.zenon.embedded.token.getByOwner(Address.parse(address), pageIndex, pageSize)
  }

  // Token by ZTS; null only when the node has no such token. Errors throw.
  async findToken(zts: string): Promise<Token | null> {
    await this.ensureInitialized()
    return this.zenon.embedded.token.getByZts(TokenStandard.parse(zts))
  }

  // The SDK sets the fee as a JS number; the node compares the exact bigint.
  issueBlock(p: IssueParams): AccountBlockTemplate {
    const block = this.zenon.embedded.token.issueToken(
      p.name,
      p.symbol,
      p.domain,
      p.totalSupply,
      p.maxSupply,
      p.decimals,
      p.mintable,
      p.burnable,
      p.utility
    )
    block.amount = TOKEN_ISSUE_FEE
    return block
  }

  // The SDK sends no ZNN with a mint.
  mintBlock(p: MintParams): AccountBlockTemplate {
    return this.zenon.embedded.token.mint(
      TokenStandard.parse(p.tokenStandard),
      p.amount,
      Address.parse(p.receiveAddress)
    )
  }

  // The block carries the burned amount of the burned token.
  burnBlock(p: BurnParams): AccountBlockTemplate {
    return this.zenon.embedded.token.burnToken(TokenStandard.parse(p.tokenStandard), p.amount)
  }

  // The SDK sends no ZNN with an update.
  updateBlock(p: UpdateParams): AccountBlockTemplate {
    return this.zenon.embedded.token.updateToken(
      TokenStandard.parse(p.tokenStandard),
      Address.parse(p.owner),
      p.mintable,
      p.burnable
    )
  }
}

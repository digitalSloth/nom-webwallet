import { TokenStandard } from 'znn-typescript-sdk'
import type { Token } from 'znn-typescript-sdk'
import { ChainService } from './chain-service'

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
}

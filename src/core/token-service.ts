import { Zenon, TokenStandard } from 'znn-typescript-sdk'
import type { Token } from 'znn-typescript-sdk'
import { ZenonService } from './zenon-service'

export class TokenService {
  private zenon: Zenon
  private zenonService: ZenonService
  private static instance: TokenService | null = null

  private constructor() {
    this.zenonService = ZenonService.getInstance()
    this.zenon = this.zenonService.getZenon()
  }

  static getInstance(): TokenService {
    if (!TokenService.instance) {
      TokenService.instance = new TokenService()
    }
    return TokenService.instance
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
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

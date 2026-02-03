import {Zenon, Address, AccountBlockTemplate, Hash} from 'znn-typescript-sdk'
import type { StakeList } from 'znn-typescript-sdk'
import { ZenonService } from './zenon-service'

export class StakeService {
  private zenon: Zenon
  private zenonService: ZenonService
  private static instance: StakeService | null = null

  private constructor() {
    this.zenonService = ZenonService.getInstance()
    this.zenon = this.zenonService.getZenon()
  }

  static getInstance(): StakeService {
    if (!StakeService.instance) {
      StakeService.instance = new StakeService()
    }
    return StakeService.instance
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
  }

  // Get stake entries for an address
  async getStakeEntries(
    address: string,
    pageIndex: number = 0,
    pageSize: number = 25
  ): Promise<StakeList> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.embedded.stake.getEntriesByAddress(addr, pageIndex, pageSize)
  }

  // Create account block template for staking ZNN
  createStakeBlock(durationInSec: number, amount: bigint): AccountBlockTemplate {
    return this.zenon.embedded.stake.stake(durationInSec, amount)
  }

  // Create account block template for canceling a stake
  createCancelStakeBlock(stakeId: string): AccountBlockTemplate {
    const hash = Hash.parse(stakeId)
    return this.zenon.embedded.stake.cancel(hash)
  }
}

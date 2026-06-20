import type {StakeList} from 'znn-typescript-sdk'
import {AccountBlockTemplate, Address, Hash} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export class StakeService extends ChainService {
  private static instance: StakeService | null = null

  static getInstance(): StakeService {
    if (!StakeService.instance) {
      StakeService.instance = new StakeService()
    }
    return StakeService.instance
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

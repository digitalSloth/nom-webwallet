import type {FusionEntryList} from 'znn-typescript-sdk'
import {AccountBlockTemplate, Address, Hash} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export class PlasmaService extends ChainService {
  private static instance: PlasmaService | null = null

  static getInstance(): PlasmaService {
    if (!PlasmaService.instance) {
      PlasmaService.instance = new PlasmaService()
    }
    return PlasmaService.instance
  }

  // Get fusion entries for an address
  async getFusionEntries(
    address: string,
    pageIndex: number = 0,
    pageSize: number = 25
  ): Promise<FusionEntryList> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.embedded.plasma.getEntriesByAddress(addr, pageIndex, pageSize)
  }

  // Create account block template for fusing QSR to generate plasma
  createFuseBlock(beneficiaryAddress: string, amount: bigint): AccountBlockTemplate {
    const beneficiary = Address.parse(beneficiaryAddress)
    return this.zenon.embedded.plasma.fuse(beneficiary, amount)
  }

  // Create account block template for canceling a fusion
  createCancelBlock(fusionId: string): AccountBlockTemplate {
    const hash = Hash.parse(fusionId)
    return this.zenon.embedded.plasma.cancel(hash)
  }
}

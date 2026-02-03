import {Zenon, Address, AccountBlockTemplate, Hash} from 'znn-typescript-sdk'
import type { FusionEntryList } from 'znn-typescript-sdk'
import { ZenonService } from './zenon-service'

export class PlasmaService {
  private zenon: Zenon
  private zenonService: ZenonService
  private static instance: PlasmaService | null = null

  private constructor() {
    this.zenonService = ZenonService.getInstance()
    this.zenon = this.zenonService.getZenon()
  }

  static getInstance(): PlasmaService {
    if (!PlasmaService.instance) {
      PlasmaService.instance = new PlasmaService()
    }
    return PlasmaService.instance
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
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

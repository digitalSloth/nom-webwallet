import type {AccountBlockTemplate, PillarInfoList} from 'znn-typescript-sdk'
import {PILLAR_ADDRESS, Zenon, ZNN_ZTS} from 'znn-typescript-sdk'
import {ZenonService} from './zenon-service'

export class PillarService {
  private zenon: Zenon
  private zenonService: ZenonService
  private static instance: PillarService | null = null

  private constructor() {
    this.zenonService = ZenonService.getInstance()
    this.zenon = this.zenonService.getZenon()
  }

  static getInstance(): PillarService {
    if (!PillarService.instance) {
      PillarService.instance = new PillarService()
    }
    return PillarService.instance
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
  }

  // Get all pillars
  async getAllPillars(pageIndex: number = 0, pageSize: number = 200): Promise<PillarInfoList> {
    await this.ensureInitialized()
    return await this.zenon.embedded.pillar.getAll(pageIndex, pageSize)
  }

  // Create delegate block
  createDelegateBlock(name: string): AccountBlockTemplate {
    return this.zenon.embedded.pillar.delegate(name)
  }

  // Create undelegate block
  createUndelegateBlock(): AccountBlockTemplate {
    return this.zenon.embedded.pillar.undelegate()
  }

  // Get total delegated ZNN from PILLAR_ADDRESS
  async getTotalDelegatedZnn(): Promise<bigint> {
    await this.ensureInitialized()
    try {
      const accountInfo = await this.zenon.ledger.getAccountInfoByAddress(PILLAR_ADDRESS)
      if (!accountInfo) {
        return BigInt(0)
      }

      // Get ZNN balance from balanceInfoMap using ZNN_ZTS as key
      const znnZts = ZNN_ZTS.toString()
      const znnBalance = accountInfo.balanceInfoMap?.[znnZts]

      return znnBalance ? BigInt(znnBalance.balance.toString()) : BigInt(0)
    } catch {
      return BigInt(0)
    }
  }
}

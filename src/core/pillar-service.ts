import type {AccountBlockTemplate, PillarInfoList} from 'znn-typescript-sdk'
import {PILLAR_ADDRESS, ZNN_ZTS} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export class PillarService extends ChainService {
  private static instance: PillarService | null = null

  static getInstance(): PillarService {
    if (!PillarService.instance) {
      PillarService.instance = new PillarService()
    }
    return PillarService.instance
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

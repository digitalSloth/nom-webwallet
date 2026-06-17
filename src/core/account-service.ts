import type {AccountBlockList, AccountInfo, PlasmaInfo} from 'znn-typescript-sdk'
import {Address, DelegationInfo} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export type PlasmaLevel = 'low' | 'medium' | 'high'

export class AccountService extends ChainService {
  private static instance: AccountService | null = null

  static getInstance(): AccountService {
    if (!AccountService.instance) {
      AccountService.instance = new AccountService()
    }
    return AccountService.instance
  }

  // Get account balance information
  async getAccountInfo(address: string): Promise<AccountInfo | null> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.ledger.getAccountInfoByAddress(addr)
  }

  // Get plasma information for an account
  async getPlasmaInfo(address: string): Promise<PlasmaInfo> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.embedded.plasma.get(addr)
  }

  // Calculate plasma level based on current plasma amount
  getPlasmaLevel(currentPlasma: number): PlasmaLevel {
    if (currentPlasma >= 120) return 'high'
    if (currentPlasma >= 40) return 'medium'
    return 'low'
  }

  // Get unreceived blocks (pending incoming transactions)
  async getUnreceivedBlocks(
    address: string,
    pageIndex: number = 0,
    pageSize: number = 10
  ): Promise<AccountBlockList> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.ledger.getUnreceivedBlocksByAddress(addr, pageIndex, pageSize)
  }

  // Get delegated pillar information
  async getDelegatedPillar(address: string): Promise<DelegationInfo | null> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    try {
      return await this.zenon.embedded.pillar.getDelegatedPillar(addr)
    } catch (e) {
      console.error('Failed to get delegated pillar:', e)
      return null
    }
  }
}

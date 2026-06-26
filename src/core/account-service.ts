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

  // Calculate plasma level from the account's current (available) plasma.
  // This is what the node uses to decide whether a transaction needs PoW —
  // not the fused QSR amount, which can be high while plasma is depleted.
  // Bands are anchored on the protocol base plasma per transaction (21,000):
  // below it a basic send cannot avoid PoW.
  getPlasmaLevel(currentPlasma: number): PlasmaLevel {
    const BASE_PLASMA = 21_000
    if (currentPlasma >= 4 * BASE_PLASMA) return 'high'
    if (currentPlasma >= BASE_PLASMA) return 'medium'
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

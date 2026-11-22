import type {AccountBlockList, AccountInfo, PlasmaInfo} from 'znn-typescript-sdk'
import {Address, BlockTypeEnum, DelegationInfo, GetRequiredPowParam} from 'znn-typescript-sdk'
import {ChainService} from './chain-service'

export type PlasmaLevel = 'low' | 'medium' | 'high'

/** Basic sends the plasma must cover for the level to read high. */
const HIGH_PLASMA_SENDS = 10

/** go-zenon nom.DynamicPlasmaMomentumVersion: momentums from this version are priced by Dynamic Plasma. */
const DYNAMIC_PLASMA_MOMENTUM_VERSION = 2

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

  // PoW difficulty the node requires for the account's next receive block.
  // Zero means the account's plasma covers it. This is the query the SDK
  // makes when it prepares a block.
  async getRequiredPoWForReceive(address: string): Promise<number> {
    await this.ensureInitialized()
    const param = new GetRequiredPowParam(Address.parse(address), BlockTypeEnum.UserReceive)
    const required = await this.zenon.embedded.plasma.getRequiredPoWForAccountBlock(param)
    return required.requiredDifficulty
  }

  // Whether the node prices plasma dynamically, read from the frontier
  // momentum's version, the flag the node itself prices by.
  async isDynamicPlasmaActive(): Promise<boolean> {
    await this.ensureInitialized()
    const momentum = await this.zenon.ledger.getFrontierMomentum()
    return momentum.version >= DYNAMIC_PLASMA_MOMENTUM_VERSION
  }

  // The fused plasma one basic send (a plain send, no data) needs now, and
  // the plasma the address can spend. The SDK's model drops
  // requiredFusedPlasma, so this reads the raw answer; a node without the
  // field charges basePlasma.
  async getBasicSendQuote(address: string): Promise<{ available: number; perSend: number }> {
    await this.ensureInitialized()
    const client = this.zenon.client
    if (!client) throw new Error('Not connected to a node')
    const addr = Address.parse(address)
    const param = new GetRequiredPowParam(addr, BlockTypeEnum.UserSend, addr)
    const answer = await client.sendRequest('embedded.plasma.getRequiredPoWForAccountBlock', [
      param.toJson(),
    ])
    return {
      available: answer.availablePlasma,
      perSend: answer.requiredFusedPlasma ?? answer.basePlasma,
    }
  }

  // Plasma level in basic sends priced by the node: `available` is what the
  // account can spend now, which is what the node checks to decide whether
  // a block needs PoW, not the fused QSR amount. `perSend` is the fused
  // plasma one basic send needs at the node's current price. Below one send
  // the account needs PoW; ten sends or more reads high.
  getPlasmaLevel(available: number, perSend: number): PlasmaLevel {
    if (available >= HIGH_PLASMA_SENDS * perSend) return 'high'
    if (available >= perSend) return 'medium'
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

  // Get account blocks (sent and received), newest first
  async getAccountBlocks(
    address: string,
    pageIndex: number = 0,
    pageSize: number = 10
  ): Promise<AccountBlockList> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.ledger.getAccountBlocksByPage(addr, pageIndex, pageSize)
  }

  // Account blocks from `height` (inclusive), up to `count` of them
  async getAccountBlocksByHeight(
    address: string,
    height: number,
    count: number
  ): Promise<AccountBlockList> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    return await this.zenon.ledger.getAccountBlocksByHeight(addr, height, count)
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

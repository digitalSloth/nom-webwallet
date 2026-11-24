import type { UncollectedReward } from 'znn-typescript-sdk'
import { AccountBlockTemplate, Address, Zenon } from 'znn-typescript-sdk'
import { ChainService } from './chain-service'

export type RewardType = 'pillar' | 'sentinel' | 'stake' | 'liquidity'

/** Collection and display order of the reward sources. */
export const REWARD_TYPES: readonly RewardType[] = ['pillar', 'stake', 'sentinel', 'liquidity']

export const REWARD_SOURCE_LABELS: Record<RewardType, string> = {
  pillar: 'Pillar & delegation',
  stake: 'Staking',
  sentinel: 'Sentinel',
  liquidity: 'Liquidity',
}

const EPOCH_SECONDS = 86_400 // 24 h epochs

export interface RewardEpoch {
  epoch: number
  /** Raw base units per source, as decimal strings. */
  znn: Record<RewardType, string>
  qsr: Record<RewardType, string>
}

/** Unix seconds at which `epoch` starts. */
export function epochStart(epoch: number, genesisSeconds: number): number {
  return genesisSeconds + epoch * EPOCH_SECONDS
}

function zeroSources(): Record<RewardType, string> {
  return { pillar: '0', stake: '0', sentinel: '0', liquidity: '0' }
}

export interface RewardInfo {
  type: RewardType
  reward: UncollectedReward
}

export class RewardsService extends ChainService {
  private static instance: RewardsService | null = null

  static getInstance(): RewardsService {
    if (!RewardsService.instance) {
      RewardsService.instance = new RewardsService()
    }
    return RewardsService.instance
  }

  private genesisByChain = new Map<number, number>()

  /** Reward history of the last `epochs` epochs, one entry per epoch, oldest first. */
  async getRewardHistory(address: string, epochs = 30): Promise<RewardEpoch[]> {
    await this.ensureInitialized()
    const addr = Address.parse(address)
    const { pillar, stake, sentinel, liquidity } = this.zenon.embedded
    const lists = await Promise.all([
      pillar.getFrontierRewardByPage(addr, 0, epochs),
      stake.getFrontierRewardByPage(addr, 0, epochs),
      sentinel.getFrontierRewardByPage(addr, 0, epochs),
      liquidity.getFrontierRewardByPage(addr, 0, epochs),
    ])
    const sources: RewardType[] = ['pillar', 'stake', 'sentinel', 'liquidity']
    // Node data: an unsafe epoch would make the window loop below unbounded.
    const valid = (epoch: number) => Number.isSafeInteger(epoch) && epoch >= 0

    let max = -1
    for (const list of lists) {
      for (const entry of list.list ?? []) if (valid(entry.epoch)) max = Math.max(max, entry.epoch)
    }
    if (max < 0) return []

    const first = Math.max(0, max - epochs + 1)
    const byEpoch = new Map<number, RewardEpoch>()
    for (let epoch = first; epoch <= max; epoch++) {
      byEpoch.set(epoch, { epoch, znn: zeroSources(), qsr: zeroSources() })
    }
    lists.forEach((list, i) => {
      const type = sources[i]
      for (const entry of list.list ?? []) {
        const row = byEpoch.get(entry.epoch)
        if (!row) continue
        row.znn[type] = (BigInt(row.znn[type]) + BigInt(entry.znnAmount.toString())).toString()
        row.qsr[type] = (BigInt(row.qsr[type]) + BigInt(entry.qsrAmount.toString())).toString()
      }
    })
    return [...byEpoch.values()]
  }

  /** Unix seconds of momentum 1, read once per configured chain id. */
  async getGenesisTime(): Promise<number> {
    const chainId = Zenon.getChainIdentifier()
    const cached = this.genesisByChain.get(chainId)
    if (cached !== undefined) return cached
    await this.ensureInitialized()
    const list = await this.zenon.ledger.getMomentumsByHeight(1, 1)
    const timestamp = list.list?.[0]?.timestamp
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
      throw new Error('The node returned no genesis momentum.')
    }
    this.genesisByChain.set(chainId, timestamp)
    return timestamp
  }

  // Get uncollected rewards for all reward types
  async getAllUncollectedRewards(address: string): Promise<RewardInfo[]> {
    await this.ensureInitialized()

    const rewardTypes: RewardType[] = ['pillar', 'sentinel', 'stake', 'liquidity']
    const rewards: RewardInfo[] = []

    for (const type of rewardTypes) {
      const reward = await this.getUncollectedReward(address, type)
      if (reward) {
        rewards.push({ type, reward })
      }
    }

    return rewards
  }

  // Get uncollected reward for a specific type
  async getUncollectedReward(address: string, type: RewardType): Promise<UncollectedReward | null> {
    await this.ensureInitialized()
    const addr = Address.parse(address)

    try {
      switch (type) {
        case 'pillar':
          return await this.zenon.embedded.pillar.getUncollectedReward(addr)
        case 'sentinel':
          return await this.zenon.embedded.sentinel.getUncollectedReward(addr)
        case 'stake':
          return await this.zenon.embedded.stake.getUncollectedReward(addr)
        case 'liquidity':
          return await this.zenon.embedded.liquidity.getUncollectedReward(addr)
      }
    } catch (e) {
      console.error(`Failed to get ${type} uncollected reward:`, e)
      return null
    }
  }

  // Create account block template for collecting rewards
  createCollectRewardBlock(type: RewardType): AccountBlockTemplate {
    switch (type) {
      case 'pillar':
        return this.zenon.embedded.pillar.collectRewards()
      case 'sentinel':
        return this.zenon.embedded.sentinel.collectRewards()
      case 'stake':
        return this.zenon.embedded.stake.collectReward()
      case 'liquidity':
        return this.zenon.embedded.liquidity.collectReward()
    }
  }
}

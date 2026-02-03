import type {UncollectedReward} from 'znn-typescript-sdk'
import {AccountBlockTemplate, Address, Zenon} from 'znn-typescript-sdk'
import {ZenonService} from './zenon-service'

export type RewardType = 'pillar' | 'sentinel' | 'stake' | 'liquidity'

export interface RewardInfo {
  type: RewardType
  reward: UncollectedReward
}

export class RewardsService {
  private zenon: Zenon
  private zenonService: ZenonService
  private static instance: RewardsService | null = null

  private constructor() {
    this.zenonService = ZenonService.getInstance()
    this.zenon = this.zenonService.getZenon()
  }

  static getInstance(): RewardsService {
    if (!RewardsService.instance) {
      RewardsService.instance = new RewardsService()
    }
    return RewardsService.instance
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
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

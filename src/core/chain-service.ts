import type {Zenon} from 'znn-typescript-sdk'
import {ZenonService} from './zenon-service'

// Base for services that talk to the chain through a single shared ZenonService.
// The 7 network services (Account/Transaction/Stake/Plasma/Pillar/Rewards/Token)
// extend this. ZenonService is injected (defaulted to the prod singleton) so the
// services are constructable with a fake in tests. Each subclass keeps its own
// `static instance` + `getInstance()` — the base intentionally does NOT own the
// singleton machinery (TS strict mode cannot type one inherited static getInstance
// across the differing constructor arities; see spec Decision).
//
// The ctor is PUBLIC: `abstract` on the class is what forbids `new ChainService()`;
// a public ctor is required so the synthesized subclass default ctors stay public,
// which is what lets a test module do `new AccountService(fakeZenonService)`.
export abstract class ChainService {
  protected zenon: Zenon

  constructor(protected zenonService: ZenonService = ZenonService.getInstance()) {
    this.zenon = zenonService.getZenon()
  }

  async ensureInitialized(): Promise<void> {
    await this.zenonService.ensureInitialized()
  }
}

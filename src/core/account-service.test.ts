import { describe, expect, it, vi } from 'vitest'

import vector from '@/core/plasma-level.vector.json'

vi.mock('./zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))

import { AccountService } from './account-service'

const ADDRESS = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

function build(answer: unknown, client: boolean = true) {
  const sendRequest = vi.fn(async () => answer)
  const ensureInitialized = vi.fn(async () => {})
  const service = new AccountService({
    getZenon: () => ({ client: client ? { sendRequest } : undefined }) as never,
    ensureInitialized,
  })
  return { service, sendRequest, ensureInitialized }
}

describe('getPlasmaLevel', () => {
  it.each(vector)('$case', ({ available, perSend, level }) => {
    const { service } = build({})

    expect(service.getPlasmaLevel(available, perSend)).toBe(level)
  })
})

describe('isDynamicPlasmaActive', () => {
  const withVersion = (version: number) => {
    const ensureInitialized = vi.fn(async () => {})
    const service = new AccountService({
      getZenon: () => ({ ledger: { getFrontierMomentum: async () => ({ version }) } }) as never,
      ensureInitialized,
    })
    return { service, ensureInitialized }
  }

  it('is false for a version 1 frontier momentum', async () => {
    expect(await withVersion(1).service.isDynamicPlasmaActive()).toBe(false)
  })

  it('is true for a version 2 frontier momentum', async () => {
    const { service, ensureInitialized } = withVersion(2)

    expect(await service.isDynamicPlasmaActive()).toBe(true)
    expect(ensureInitialized).toHaveBeenCalled()
  })
})

describe('getBasicSendQuote', () => {
  it('asks the node about a plain send from the address to itself', async () => {
    const { service, sendRequest, ensureInitialized } = build({
      availablePlasma: 50_000,
      basePlasma: 21_000,
      requiredFusedPlasma: 23_100,
      requiredDifficulty: 0,
    })

    await service.getBasicSendQuote(ADDRESS)

    expect(ensureInitialized).toHaveBeenCalled()
    expect(sendRequest).toHaveBeenCalledOnce()
    const [method, params] = sendRequest.mock.calls[0] as unknown as [string, Record<string, unknown>[]]
    expect(method).toBe('embedded.plasma.getRequiredPoWForAccountBlock')
    expect(params[0]).toMatchObject({ address: ADDRESS, toAddress: ADDRESS, blockType: 2 })
  })

  it('returns the fused plasma as the price of a send', async () => {
    const { service } = build({
      availablePlasma: 50_000,
      basePlasma: 21_000,
      requiredFusedPlasma: 23_100,
      requiredDifficulty: 0,
    })

    expect(await service.getBasicSendQuote(ADDRESS)).toEqual({ available: 50_000, perSend: 23_100 })
  })

  it('falls back to the base plasma when the node omits the fused plasma', async () => {
    const { service } = build({ availablePlasma: 0, basePlasma: 21_000, requiredDifficulty: 5 })

    expect(await service.getBasicSendQuote(ADDRESS)).toEqual({ available: 0, perSend: 21_000 })
  })

  it('throws when there is no node connection', async () => {
    const { service } = build({}, false)

    await expect(service.getBasicSendQuote(ADDRESS)).rejects.toThrow('Not connected to a node')
  })
})

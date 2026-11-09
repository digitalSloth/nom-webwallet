import { describe, expect, it } from 'vitest'
import {
  Address,
  Hash,
  PILLAR_ADDRESS,
  PLASMA_ADDRESS,
  STAKE_ADDRESS,
  Zenon,
} from 'znn-typescript-sdk'

import { decodeContractCall } from '@/core/contract-call'

const embedded = Zenon.getInstance().embedded
const USER_ADDRESS = 'z1qzal6c5s9rjnnxd2z7dvdhjxpmmj4fmw56a0mz'

describe('decodeContractCall', () => {
  it('decodes a pillar delegation into its function and named arguments', () => {
    const block = embedded.pillar.delegate('Anvil')

    expect(decodeContractCall(PILLAR_ADDRESS.toString(), block.data)).toEqual({
      contract: 'Pillar',
      method: 'Delegate',
      args: [{ name: 'name', value: 'Anvil' }],
    })
  })

  it('formats address, number and hash arguments as text', () => {
    const fuse = embedded.plasma.fuse(Address.parse(USER_ADDRESS), 10n ** 9n)
    expect(decodeContractCall(PLASMA_ADDRESS.toString(), fuse.data)?.args).toEqual([
      { name: 'address', value: USER_ADDRESS },
    ])

    const stake = embedded.stake.stake(31536000, 10n ** 9n)
    expect(decodeContractCall(STAKE_ADDRESS.toString(), stake.data)?.args).toEqual([
      { name: 'durationInSec', value: '31536000' },
    ])

    const id = `0x${'ab'.repeat(32)}`
    const cancel = embedded.stake.cancel(Hash.parse('ab'.repeat(32)))
    expect(decodeContractCall(STAKE_ADDRESS.toString(), cancel.data)).toEqual({
      contract: 'Stake',
      method: 'Cancel',
      args: [{ name: 'id', value: id }],
    })
  })

  it('decodes a call with no arguments', () => {
    const block = embedded.pillar.collectRewards()

    expect(decodeContractCall(PILLAR_ADDRESS.toString(), block.data)).toEqual({
      contract: 'Pillar',
      method: 'CollectReward',
      args: [],
    })
  })

  it('refuses data with trailing bytes the decoded view would hide', () => {
    const block = embedded.pillar.delegate('Anvil')
    const padded = new Uint8Array([...block.data, 0xde, 0xad, 0xbe, 0xef])

    expect(decodeContractCall(PILLAR_ADDRESS.toString(), padded)).toBeNull()
  })

  it('decodes only with the ABI of the contract the block is sent to', () => {
    const block = embedded.pillar.delegate('Anvil')

    expect(decodeContractCall(PLASMA_ADDRESS.toString(), block.data)).toBeNull()
  })

  it('returns null for a recipient that is not an embedded contract', () => {
    const block = embedded.pillar.delegate('Anvil')

    expect(decodeContractCall(USER_ADDRESS, block.data)).toBeNull()
  })

  it('returns null for data that matches no function, and for empty data', () => {
    const pillar = PILLAR_ADDRESS.toString()

    expect(decodeContractCall(pillar, new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBeNull()
    expect(decodeContractCall(pillar, new Uint8Array())).toBeNull()
  })
})

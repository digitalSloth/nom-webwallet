import { Buffer } from 'buffer'
import {
  ACCELERATOR_ADDRESS,
  AcceleratorContract,
  BRIDGE_ADDRESS,
  BridgeContract,
  HTLC_ADDRESS,
  HtlcContract,
  LIQUIDITY_ADDRESS,
  LiquidityContract,
  PILLAR_ADDRESS,
  PillarContract,
  PLASMA_ADDRESS,
  PlasmaContract,
  SENTINEL_ADDRESS,
  SentinelContract,
  SPORK_ADDRESS,
  SporkContract,
  STAKE_ADDRESS,
  StakeContract,
  SWAP_ADDRESS,
  SwapContract,
  TOKEN_ADDRESS,
  TokenContract,
} from 'znn-typescript-sdk'
import type { EmbeddedContract } from 'znn-typescript-sdk'

export interface DecodedCall {
  contract: string
  method: string
  args: Array<{ name: string; value: string }>
}

// Each embedded contract decodes only with its own ABI, so a call is never
// named after a function that a different contract happens to share a
// selector with.
const EMBEDDED_CONTRACTS = new Map<string, { name: string; abi: typeof EmbeddedContract }>([
  [ACCELERATOR_ADDRESS.toString(), { name: 'Accelerator', abi: AcceleratorContract }],
  [BRIDGE_ADDRESS.toString(), { name: 'Bridge', abi: BridgeContract }],
  [HTLC_ADDRESS.toString(), { name: 'HTLC', abi: HtlcContract }],
  [LIQUIDITY_ADDRESS.toString(), { name: 'Liquidity', abi: LiquidityContract }],
  [PILLAR_ADDRESS.toString(), { name: 'Pillar', abi: PillarContract }],
  [PLASMA_ADDRESS.toString(), { name: 'Plasma', abi: PlasmaContract }],
  [SENTINEL_ADDRESS.toString(), { name: 'Sentinel', abi: SentinelContract }],
  [SPORK_ADDRESS.toString(), { name: 'Spork', abi: SporkContract }],
  [STAKE_ADDRESS.toString(), { name: 'Stake', abi: StakeContract }],
  [SWAP_ADDRESS.toString(), { name: 'Swap', abi: SwapContract }],
  [TOKEN_ADDRESS.toString(), { name: 'Token', abi: TokenContract }],
])

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`
  return String(value)
}

/**
 * Decodes the data of a call to an embedded contract into its function name
 * and arguments. Returns null when the recipient is not an embedded contract,
 * the data does not match one of its functions, or re-encoding the decoded
 * call does not give back the exact bytes. That last check stops a decoded
 * view from hiding trailing bytes the decoder skipped.
 */
export function decodeContractCall(toAddress: string, data: Uint8Array): DecodedCall | null {
  const contract = EMBEDDED_CONTRACTS.get(toAddress)
  if (!contract || data.length === 0) return null

  const hex = `0x${Buffer.from(data).toString('hex')}`
  try {
    const { name } = contract.abi.decodeCallData(hex)
    const values = Array.from(contract.abi.decodeCall(name, hex, false) as unknown[])
    if (contract.abi.encodeCall(name, values).toLowerCase() !== hex) return null

    const named = contract.abi.decodeCall(name, hex, true) as Record<string, unknown>
    return {
      contract: contract.name,
      method: name,
      args: Object.entries(named).map(([argName, value]) => ({
        name: argName,
        value: formatValue(value),
      })),
    }
  } catch {
    return null
  }
}

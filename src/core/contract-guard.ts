import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { decodeContractCall } from './contract-call'
import { getSendRecorder } from './send-recorder'

// Methods guarded across tabs and reloads. `target` names what the call acts on:
// a token standard argument, the burned token, an HTLC id, or nothing.
const GUARDED: Record<string, { label: string; target: 'zts' | 'burned' | 'id' | null }> = {
  'Token.IssueToken': { label: 'token issue', target: null },
  'Token.Mint': { label: 'mint', target: 'zts' },
  'Token.Burn': { label: 'burn', target: 'burned' },
  'Token.UpdateToken': { label: 'token update', target: 'zts' },
  'HTLC.Create': { label: 'HTLC create', target: null },
  'HTLC.Unlock': { label: 'HTLC unlock', target: 'id' },
  'HTLC.Reclaim': { label: 'HTLC reclaim', target: 'id' },
  'HTLC.AllowProxyUnlock': { label: 'proxy allow', target: null },
  'HTLC.DenyProxyUnlock': { label: 'proxy deny', target: null },
}

function describeCall(block: AccountBlockTemplate): { key: string; label: string } | null {
  let decoded
  try {
    decoded = decodeContractCall(block.toAddress.toString(), block.data)
  } catch {
    return null
  }
  if (!decoded) return null
  const id = `${decoded.contract}.${decoded.method}`
  const guarded = GUARDED[id]
  if (!guarded) return null
  let target = ''
  if (guarded.target === 'burned') target = block.tokenStandard.toString()
  else if (guarded.target) {
    const name = guarded.target === 'zts' ? 'tokenStandard' : 'id'
    const arg = decoded.args.find((a) => a.name === name)
    if (!arg) return null
    target = arg.value
  }
  return { key: target ? `${id}:${target}` : id, label: guarded.label }
}

/**
 * Refuses a guarded call while a send record on this device, left by any
 * tab or before a reload, calls the same method on the same target from the
 * same account. The record stays until Activity or /interrupted resolves
 * it. Returns the call key to store on the new record, or undefined for an
 * unguarded call.
 */
export async function assertNoUnresolvedCall(
  block: AccountBlockTemplate,
  from: string
): Promise<string | undefined> {
  const call = describeCall(block)
  if (!call) return undefined
  const recorder = getSendRecorder()
  if (!recorder.stored) return call.key
  let contexts
  try {
    contexts = await recorder.stored()
  } catch (err) {
    console.warn('Send record storage call failed', err)
    throw new Error("Couldn't check for earlier sends on this device. Nothing was sent.")
  }
  if (contexts.some((c) => c.from === from && c.call === call.key)) {
    throw new Error(
      `A previous ${call.label} may still be sending. Check Activity. If a wallet tab is still sending it, close or reload that tab, then resolve the interrupted send on Home. Nothing was sent.`
    )
  }
  return call.key
}

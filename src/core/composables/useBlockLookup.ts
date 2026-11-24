import type { AccountBlock } from 'znn-typescript-sdk'
import type { TxMeta } from '../send-recorder'
import { TransactionService } from '../transaction-service'
import { readStage } from '../tx-tracker'
import { activityLabel, toActivityRow } from './useAccountHistory'
import type { TrackedEntry } from './useTxTracker'

/**
 * Reads one block by hash and reports where it stands. The result is not
 * tracked, stored or announced: the caller shows it once.
 */
export function useBlockLookup(): { lookup(hash: string): Promise<TrackedEntry | null> } {
  async function lookup(hash: string): Promise<TrackedEntry | null> {
    const service = TransactionService.getInstance()
    const block = await service.getAccountBlock(hash)
    if (!block) return null

    const address = block.address.toString()
    const row = toActivityRow(block, address)
    const label = activityLabel(row)
    const getBlock = (target: string): Promise<AccountBlock | null> =>
      target === hash ? Promise.resolve(block) : service.getAccountBlock(target)
    const stage = await readStage(hash, getBlock, { followRecipient: true })

    const meta: TxMeta = {
      kind: row.direction === 'in' ? 'receive' : row.direction === 'contract' ? 'contract' : 'send',
      title: label,
      amount: row.amount,
      decimals: row.decimals,
      ...(row.symbol ? { symbol: row.symbol } : {}),
      ...(row.direction !== 'in' && row.counterparty ? { recipient: row.counterparty } : {}),
    }
    return {
      tx: { hash: row.hash, label, address, publishedAt: row.timestamp ?? Date.now(), meta },
      stage,
      done: true,
      updatedAt: Date.now(),
    }
  }

  return { lookup }
}

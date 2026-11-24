import { ref } from 'vue'
import type { Ref } from 'vue'
import { addNumberDecimals } from 'znn-typescript-sdk'
import type { AccountBlock } from 'znn-typescript-sdk'
import type { useAccount } from './useAccount'
import { PublishRejectedError } from '../transaction-service'
import { useTransaction } from './useTransaction'
import { useWallet } from './useWallet'

const PAGE_SIZE = 10

// Send hashes with a receive in flight, shared by every page that receives.
export const receiving = new Set<string>()

const ALREADY_RECEIVED = 'account-block from-block already received'

/** True when the node refused a receive because the send is already received. */
export function isAlreadyReceived(err: unknown): boolean {
  return err instanceof PublishRejectedError && err.reason.startsWith(ALREADY_RECEIVED)
}

export function amountText(block: AccountBlock): string {
  return block.token
    ? addNumberDecimals(block.amount, block.token.decimals)
    : block.amount.toString()
}

export function receiveMeta(block: AccountBlock, title: string | undefined, progress: string) {
  const token = block.token
  if (!token) return { kind: 'receive' as const, title: title ?? 'Receive', progress }
  return {
    kind: 'receive' as const,
    title: title ?? `Receive ${amountText(block)} ${token.symbol}`,
    progress,
    amount: block.amount.toString(),
    decimals: token.decimals,
    symbol: token.symbol,
    tokenStandard: block.tokenStandard.toString(),
  }
}

/** The unreceived blocks of an account and the actions that receive them. */
export function useIncoming(options: {
  address: () => string | null
  account: Pick<ReturnType<typeof useAccount>, 'loadUnreceivedBlocks' | 'loadUnreceivedCount'>
  /** Called instead of publishing when the active wallet is locked. */
  onLocked: () => void
}): {
  blocks: Ref<AccountBlock[]>
  more: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string | null>
  bulkFailure: Ref<string | null>
  loadFirstPage(): Promise<void>
  receiveOne(block: AccountBlock): Promise<void>
  /** The last published hash once every block is received; null when locked, empty or stopped by a failure. */
  receiveAll(): Promise<string | null>
  retryAll(): Promise<string | null>
} {
  const wallet = useWallet()
  const transaction = useTransaction()
  const { account } = options

  const blocks = ref<AccountBlock[]>([])
  const more = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const bulkFailure = ref<string | null>(null)

  async function loadFirstPage(): Promise<void> {
    const result = await account.loadUnreceivedBlocks(0, PAGE_SIZE)
    blocks.value = result.list
    more.value = result.more
  }

  async function receiveOne(block: AccountBlock): Promise<void> {
    const activeWallet = wallet.activeWallet.value
    const address = options.address()
    if (!activeWallet || !address) return
    if (!wallet.isActiveWalletUnlocked.value) {
      options.onLocked()
      return
    }
    const hash = block.hash.toString()
    if (receiving.has(hash)) return
    receiving.add(hash)
    busy.value = true
    error.value = null
    try {
      await transaction.receiveTransaction(
        activeWallet,
        address,
        hash,
        receiveMeta(block, undefined, 'Receiving')
      )
      blocks.value = blocks.value.filter((b) => b.hash.toString() !== block.hash.toString())
      await account.loadUnreceivedCount()
    } catch (err) {
      if (isAlreadyReceived(err)) {
        blocks.value = blocks.value.filter((b) => b.hash.toString() !== block.hash.toString())
        await account.loadUnreceivedCount()
        return
      }
      error.value = err instanceof Error ? err.message : 'Failed to receive transaction'
    } finally {
      receiving.delete(hash)
      busy.value = false
    }
  }

  async function receiveAll(): Promise<string | null> {
    const activeWallet = wallet.activeWallet.value
    const address = options.address()
    if (!activeWallet || !address) return null
    if (!wallet.isActiveWalletUnlocked.value) {
      options.onLocked()
      return null
    }
    const snapshot = blocks.value.filter((b) => !receiving.has(b.hash.toString()))
    if (snapshot.length === 0) return null
    const claimed = snapshot.map((b) => b.hash.toString())
    claimed.forEach((hash) => receiving.add(hash))
    const total = snapshot.length
    busy.value = true
    error.value = null
    bulkFailure.value = null
    let lastHash = ''
    let skipped = false
    try {
      for (const [index, block] of snapshot.entries()) {
        const position = index + 1
        try {
          const sent = await transaction.receiveTransaction(
            activeWallet,
            address,
            block.hash.toString(),
            receiveMeta(
              block,
              `Receive ${position} of ${total}`,
              `Receiving ${position} of ${total}`
            )
          )
          lastHash = sent.hash.toString()
        } catch (err) {
          if (isAlreadyReceived(err)) {
            skipped = true
            continue
          }
          const message = err instanceof Error ? err.message : 'Failed to receive transaction'
          bulkFailure.value = `Receive ${position} of ${total} failed: ${message}`
          return null
        }
      }
      await account.loadUnreceivedCount()
      if (skipped) await loadFirstPage()
      return lastHash || null
    } finally {
      claimed.forEach((hash) => receiving.delete(hash))
      busy.value = false
    }
  }

  async function retryAll(): Promise<string | null> {
    bulkFailure.value = null
    await loadFirstPage()
    return receiveAll()
  }

  return { blocks, more, busy, error, bulkFailure, loadFirstPage, receiveOne, receiveAll, retryAll }
}

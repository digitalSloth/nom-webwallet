import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { BlockTypeEnum, type AccountBlock } from 'znn-typescript-sdk'
import { AccountService } from '../account-service'
import { blockStatus, type BlockStatus } from '../tx-tracker'
import { decodeContractCall, isEmbeddedContract } from '../contract-call'

export interface ActivityRow {
  hash: string
  /** Account chain height of the block. */
  height: number
  status: BlockStatus
  direction: 'in' | 'out' | 'contract'
  /** Raw base units. */
  amount: string
  decimals: number
  symbol: string
  /** Full address, empty when unknown. */
  counterparty: string
  /** "<contract> · <method>" when the send decodes as an embedded contract call. */
  label: string | null
  /** Milliseconds, null while the block is unconfirmed. */
  timestamp: number | null
}

export const ACTIVITY_PAGE_SIZE = 10

const RECEIVE_BLOCK_TYPES = new Set<number>([
  BlockTypeEnum.GenesisReceive,
  BlockTypeEnum.UserReceive,
  BlockTypeEnum.ContractReceive,
])

// `_ownAddress` is not read yet; it is part of the signature for per-account rules.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function toActivityRow(block: AccountBlock, _ownAddress: string): ActivityRow {
  const isReceive = RECEIVE_BLOCK_TYPES.has(block.blockType)
  const source = isReceive ? (block.pairedAccountBlock ?? block) : block

  let direction: ActivityRow['direction'] = 'out'
  let counterparty = block.toAddress.toString()
  let label: string | null = null

  if (isReceive) {
    direction = 'in'
    counterparty = block.pairedAccountBlock?.address.toString() ?? ''
  } else if (isEmbeddedContract(counterparty)) {
    direction = 'contract'
    const decoded = decodeContractCall(counterparty, block.data)
    label = decoded ? `${decoded.contract} · ${decoded.method}` : null
  }

  return {
    hash: block.hash.toString(),
    height: block.height,
    status: blockStatus(block),
    direction,
    amount: source.amount.toString(),
    decimals: source.token?.decimals ?? 0,
    symbol: source.token?.symbol ?? '',
    counterparty,
    label,
    timestamp: block.confirmationDetail ? block.confirmationDetail.momentumTimestamp * 1000 : null,
  }
}

export function useAccountHistory(address: () => string | null) {
  const rows = ref<ActivityRow[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  let generation = 0

  async function load(): Promise<void> {
    const target = address()
    if (!target) return
    const current = generation
    isLoading.value = true
    try {
      const result = await AccountService.getInstance().getAccountBlocks(
        target,
        0,
        ACTIVITY_PAGE_SIZE
      )
      if (current !== generation) return
      rows.value = result.list.map((block) => toActivityRow(block, target))
    } catch (err) {
      if (current !== generation) return
      console.error('Failed to load activity:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load activity'
    } finally {
      if (current === generation) isLoading.value = false
    }
  }

  async function loadFirst(): Promise<void> {
    generation++
    rows.value = []
    error.value = null
    isLoading.value = false
    await load()
  }

  return { rows, isLoading, error, loadFirst }
}

/** The row's type text: the decoded contract label, else 'Received', 'Sent' or 'Contract call'. */
export function activityLabel(row: ActivityRow): string {
  if (row.direction === 'in') return 'Received'
  if (row.direction === 'out') return 'Sent'
  return row.label ?? 'Contract call'
}

/**
 * Pages of the account's blocks, newest first, read by height so a page
 * boundary does not move while new blocks arrive.
 */
export function useActivityPages(address: () => string | null): {
  rows: Ref<ActivityRow[]>
  page: Ref<number>
  /** Account height read by the last load(0). */
  total: Ref<number>
  /** Newest and oldest height of `page`; null while total is 0. */
  range: ComputedRef<{ from: number; to: number } | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  load(page: number): Promise<void>
  hasNewer: ComputedRef<boolean>
  hasOlder: ComputedRef<boolean>
} {
  const rows = ref<ActivityRow[]>([])
  const page = ref(0)
  const total = ref(0)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  let generation = 0

  const range = computed(() => {
    if (total.value <= 0) return null
    const from = total.value - ACTIVITY_PAGE_SIZE * page.value
    return { from, to: Math.max(1, from - (ACTIVITY_PAGE_SIZE - 1)) }
  })
  const hasNewer = computed(() => page.value > 0)
  const hasOlder = computed(() => range.value !== null && range.value.to > 1)

  async function load(target: number): Promise<void> {
    const account = address()
    if (!account || target < 0) return
    if (target > 0) {
      const lastPage = Math.ceil(total.value / ACTIVITY_PAGE_SIZE) - 1
      if (total.value === 0 || target > lastPage) return
    }
    const current = ++generation
    isLoading.value = true
    error.value = null
    try {
      const service = AccountService.getInstance()
      const height =
        target === 0 ? ((await service.getAccountInfo(account))?.blockCount ?? 0) : total.value
      let next: ActivityRow[] = []
      if (height > 0) {
        const top = height - ACTIVITY_PAGE_SIZE * target
        const low = Math.max(1, top - (ACTIVITY_PAGE_SIZE - 1))
        const result = await service.getAccountBlocksByHeight(account, low, top - low + 1)
        next = result.list
          .filter((block) => block.height >= low && block.height <= top)
          .sort((a, b) => b.height - a.height)
          .map((block) => toActivityRow(block, account))
      }
      if (current !== generation) return
      total.value = height
      page.value = height === 0 ? 0 : target
      rows.value = next
    } catch (err) {
      if (current !== generation) return
      console.error('Failed to load activity:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load activity'
    } finally {
      if (current === generation) isLoading.value = false
    }
  }

  return { rows, page, total, range, isLoading, error, load, hasNewer, hasOlder }
}

export const RECENT_RECIPIENT_SCAN = 25

/** Distinct non-contract targets of the user's sends, in block order, up to `limit`. */
export function recentRecipients(blocks: AccountBlock[], limit: number): string[] {
  const found: string[] = []
  for (const block of blocks) {
    if (found.length >= limit) break
    if (block.blockType !== BlockTypeEnum.UserSend) continue
    const to = block.toAddress.toString()
    if (isEmbeddedContract(to) || found.includes(to)) continue
    found.push(to)
  }
  return found
}

export function useRecentRecipients(address: () => string | null): { recipients: Ref<string[]> } {
  const recipients = ref<string[]>([])
  let generation = 0

  async function load(target: string | null): Promise<void> {
    const current = ++generation
    if (!target) {
      recipients.value = []
      return
    }
    try {
      const result = await AccountService.getInstance().getAccountBlocks(
        target,
        0,
        RECENT_RECIPIENT_SCAN
      )
      if (current !== generation) return
      recipients.value = recentRecipients(result.list, 3)
    } catch (err) {
      if (current !== generation) return
      console.warn('Failed to load recent recipients:', err)
      recipients.value = []
    }
  }

  watch(address, load, { immediate: true })

  return { recipients }
}

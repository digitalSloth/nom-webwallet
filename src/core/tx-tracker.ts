import {
  STORAGE_KEY_TRACKED_TRANSACTIONS,
  TX_TRACK_POLL_MS,
  TX_TRACK_READ_TIMEOUT_MS,
  TX_TRACK_TIMEOUT_MS,
} from '@/config'
import { createSerialQueue } from './serial-queue'
import type { TxMeta } from './send-recorder'
import { withTimeout } from './with-timeout'

/**
 * Follows published transactions until they settle: confirmed in a momentum,
 * received, or (for embedded contract calls) executed along with every
 * follow-on call. Free of Vue and the SDK, so it runs under plain unit tests.
 */

// Network protocol constants — cannot change without a chain fork.
// dist/model/nom/accountBlock.js:7-15
const USER_SEND = 2
const CONTRACT_SEND = 4
const CONTRACT_RECEIVE = 5
// go-zenon/common/types/address.go:19. Only this core byte marks a contract
// address (address.go:46-48), so a send to any other byte is never auto-received.
const CONTRACT_ADDRESS_BYTE = 1

export interface TrackedTx {
  /** `block.hash.toString()` */
  hash: string
  label: string
  /** `block.address.toString()`, the sending account. */
  address: string
  /** `Date.now()` at publish. */
  publishedAt: number
  meta?: TxMeta
}

/** The AccountBlock fields the tracker reads. The SDK AccountBlock satisfies it structurally. */
export interface TrackedBlock {
  blockType: number
  toAddress: { core: Uint8Array }
  data: Uint8Array
  confirmationDetail?: { momentumHeight: number }
  pairedAccountBlock?: TrackedBlock
  descendantBlocks: { hash: { toString(): string } }[]
}

export type TxStage =
  | { kind: 'published' }
  | { kind: 'confirmed'; momentum: number }
  | { kind: 'awaitingRecipient'; momentum: number }
  | { kind: 'received'; momentum: number }
  | { kind: 'executed'; pendingFollowOns: number }
  | { kind: 'failed'; momentum: number }
  | { kind: 'timedOut' }
  | { kind: 'rejected'; reason: string; node: string }

export type GetBlock = (hash: string) => Promise<TrackedBlock | null>

function isSend(block: TrackedBlock): boolean {
  return block.blockType === USER_SEND || block.blockType === CONTRACT_SEND
}

function sendsToContract(block: TrackedBlock): boolean {
  return block.toAddress.core[0] === CONTRACT_ADDRESS_BYTE
}

// An embedded contract writes its call status into its receive block's data
// as a big-endian uint64: 1 is success, 2 is a failed and rolled-back call
// (go-zenon vm/vm.go, errToStatus).
function isFailedCall(block: TrackedBlock): boolean {
  const { data } = block
  if (block.blockType !== CONTRACT_RECEIVE || data.length !== 8) return false
  for (let i = 0; i < 7; i++) {
    if (data[i] !== 0) return false
  }
  return data[7] === 2
}

export type BlockStatus =
  | 'unconfirmed'
  | 'confirmed'
  | 'executed'
  | 'failed'
  | 'notReceived'
  | 'received'

/** Status from the block and its paired block only. No extra reads. */
export function blockStatus(block: TrackedBlock): BlockStatus {
  if (!block.confirmationDetail) return 'unconfirmed'
  if (!isSend(block)) return 'confirmed'
  const paired = block.pairedAccountBlock
  if (!sendsToContract(block)) return paired ? 'received' : 'notReceived'
  if (!paired) return 'confirmed'
  return isFailedCall(paired) ? 'failed' : 'executed'
}

async function isSettled(hash: string, getBlock: GetBlock): Promise<boolean> {
  const block = await getBlock(hash)
  if (!block || !block.confirmationDetail) return false
  if (!isSend(block) || !sendsToContract(block)) return true
  const paired = block.pairedAccountBlock
  if (!paired) return false
  if (isFailedCall(paired)) return true
  const settled = await Promise.all(
    paired.descendantBlocks.map((d) => isSettled(d.hash.toString(), getBlock))
  )
  return settled.every(Boolean)
}

export interface StageOptions {
  /** Report a user send as received once the recipient's receive block exists. */
  followRecipient?: boolean
}

export async function readStage(
  hash: string,
  getBlock: GetBlock,
  options: StageOptions = {}
): Promise<TxStage> {
  const block = await getBlock(hash)
  if (!block || !block.confirmationDetail) return { kind: 'published' }
  const momentum = block.confirmationDetail.momentumHeight
  if (!isSend(block)) return { kind: 'received', momentum }
  if (!sendsToContract(block)) {
    return options.followRecipient && block.pairedAccountBlock
      ? { kind: 'received', momentum }
      : { kind: 'awaitingRecipient', momentum }
  }
  const paired = block.pairedAccountBlock
  if (!paired) return { kind: 'confirmed', momentum }
  if (isFailedCall(paired)) return { kind: 'failed', momentum }
  const settled = await Promise.all(
    paired.descendantBlocks.map((d) => isSettled(d.hash.toString(), getBlock))
  )
  return { kind: 'executed', pendingFollowOns: settled.filter((s) => !s).length }
}

export function isFinal(stage: TxStage, options: StageOptions = {}): boolean {
  switch (stage.kind) {
    case 'awaitingRecipient':
      return !options.followRecipient
    case 'received':
    case 'failed':
    case 'timedOut':
    case 'rejected':
      return true
    case 'executed':
      return stage.pendingFollowOns === 0
    default:
      return false
  }
}

export function describeStage(
  label: string,
  stage: TxStage
): { text: string; tone: 'loading' | 'success' | 'error' | 'warning' } {
  switch (stage.kind) {
    case 'published':
      return { text: `${label}: published, waiting for the network`, tone: 'loading' }
    case 'confirmed':
      return {
        text: `${label}: confirmed in momentum ${stage.momentum.toLocaleString('en-US')}, waiting for the contract`,
        tone: 'loading',
      }
    case 'awaitingRecipient':
      return {
        text: `${label}: confirmed in momentum ${stage.momentum.toLocaleString('en-US')}, waiting for the recipient`,
        tone: 'success',
      }
    case 'received':
      return {
        text: `${label}: confirmed in momentum ${stage.momentum.toLocaleString('en-US')}`,
        tone: 'success',
      }
    case 'executed': {
      const k = stage.pendingFollowOns
      if (k === 0) return { text: `${label}: executed`, tone: 'success' }
      const noun = k === 1 ? '1 follow-on block' : `${k} follow-on blocks`
      return { text: `${label}: executed, waiting for ${noun}`, tone: 'loading' }
    }
    case 'failed':
      return {
        text: `${label}: confirmed in momentum ${stage.momentum.toLocaleString('en-US')}, but the contract call failed`,
        tone: 'error',
      }
    case 'timedOut':
      return { text: `${label}: Still waiting. Check the explorer.`, tone: 'warning' }
    case 'rejected':
      return { text: `${label} was rejected by the node`, tone: 'error' }
  }
}

export interface TxTrackerDeps {
  getBlock: GetBlock
  notify: (tx: TrackedTx, stage: TxStage) => void
  storage: {
    get<T>(key: string): Promise<T | null>
    set<T>(key: string, value: T): Promise<void>
  }
  /** Keep following a user send after it confirms, until the recipient receives it. */
  followRecipient?: boolean
  /** Called once when tracking of a transaction ends, whatever the outcome. */
  stopped?: (tx: TrackedTx) => void
}

function isWellFormed(value: unknown): value is TrackedTx {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.hash === 'string' &&
    typeof v.label === 'string' &&
    typeof v.address === 'string' &&
    typeof v.publishedAt === 'number' &&
    Number.isFinite(v.publishedAt)
  )
}

// A publish time in the future counts as expired, so the tracking limit always holds.
function isExpired(tx: TrackedTx): boolean {
  const now = Date.now()
  return tx.publishedAt > now || now >= tx.publishedAt + TX_TRACK_TIMEOUT_MS
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createTxTracker(deps: TxTrackerDeps): {
  track(tx: TrackedTx): Promise<void>
  resume(): Promise<void>
} {
  const { getBlock, notify, storage, stopped } = deps
  const stageOptions = { followRecipient: deps.followRecipient ?? false }
  const following = new Set<string>()
  const exclusive = createSerialQueue()

  function emit(tx: TrackedTx, stage: TxStage): void {
    try {
      notify(tx, stage)
    } catch (err) {
      console.warn('Transaction tracker notification failed', err)
    }
  }

  async function readStored(): Promise<unknown[]> {
    const stored = await storage.get<unknown>(STORAGE_KEY_TRACKED_TRANSACTIONS)
    return Array.isArray(stored) ? stored : []
  }

  // Storage errors never stop tracking: they are logged and swallowed here.
  function queueStorage<T>(task: () => Promise<T>, fallback: T): Promise<T> {
    return exclusive(async () => {
      try {
        return await task()
      } catch (err) {
        console.warn('Transaction tracker storage failed', err)
        return fallback
      }
    })
  }

  function queueAdd(tx: TrackedTx): Promise<void> {
    return queueStorage(async () => {
      const list = await readStored()
      if (list.some((e) => isWellFormed(e) && e.hash === tx.hash)) return
      await storage.set(STORAGE_KEY_TRACKED_TRANSACTIONS, [...list, tx])
    }, undefined)
  }

  function queueRemove(hash: string): Promise<void> {
    return queueStorage(async () => {
      const list = await readStored()
      const kept = list.filter((e) => !(isWellFormed(e) && e.hash === hash))
      if (kept.length !== list.length) await storage.set(STORAGE_KEY_TRACKED_TRANSACTIONS, kept)
    }, undefined)
  }

  async function follow(tx: TrackedTx): Promise<void> {
    following.add(tx.hash)
    emit(tx, { kind: 'published' })
    let last = JSON.stringify({ kind: 'published' })
    let lastStage: TxStage = { kind: 'published' }
    let settled = false

    while (Date.now() < tx.publishedAt + TX_TRACK_TIMEOUT_MS) {
      await sleep(TX_TRACK_POLL_MS)
      let stage: TxStage
      try {
        stage = await withTimeout(
          readStage(tx.hash, getBlock, stageOptions),
          TX_TRACK_READ_TIMEOUT_MS,
          'Block read timed out'
        )
      } catch {
        continue
      }
      const key = JSON.stringify(stage)
      if (key !== last) {
        last = key
        lastStage = stage
        emit(tx, stage)
      }
      if (isFinal(stage, stageOptions)) {
        settled = true
        break
      }
    }

    const endedAwaitingRecipient =
      stageOptions.followRecipient && lastStage.kind === 'awaitingRecipient'
    if (!settled && !endedAwaitingRecipient) emit(tx, { kind: 'timedOut' })
    following.delete(tx.hash)
    try {
      stopped?.(tx)
    } catch (err) {
      console.warn('Transaction tracker notification failed', err)
    }
    void queueRemove(tx.hash)
  }

  function track(tx: TrackedTx): Promise<void> {
    if (following.has(tx.hash)) return Promise.resolve()
    const added = queueAdd(tx)
    void follow(tx)
    return added
  }

  async function resume(): Promise<void> {
    const unexpired = await queueStorage(async () => {
      const list = await readStored()
      const kept = list.filter((e): e is TrackedTx => isWellFormed(e) && !isExpired(e))
      if (kept.length !== list.length) await storage.set(STORAGE_KEY_TRACKED_TRANSACTIONS, kept)
      return kept
    }, [] as TrackedTx[])
    for (const tx of unexpired) {
      if (!following.has(tx.hash)) void follow(tx)
    }
  }

  return { track, resume }
}

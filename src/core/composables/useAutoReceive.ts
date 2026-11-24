import { computed, watch } from 'vue'
import { useToast } from 'nom-ui'
import { QSR_ZTS, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountBlock } from 'znn-typescript-sdk'
import {
  AUTO_RECEIVE_LOCK,
  AUTO_RECEIVE_MAX_BACKOFF_MS,
  AUTO_RECEIVE_MAX_PAGES,
  AUTO_RECEIVE_PAGE_SIZE,
  AUTO_RECEIVE_POW_LIMIT,
  AUTO_RECEIVE_POW_WINDOW_MS,
  AUTO_RECEIVE_RETRY_MS,
  STORAGE_KEY_AUTO_RECEIVE_POW,
} from '@/config'
import { AccountService } from '../account-service'
import { isGeneratingPow } from '../pow-status'
import { isSendBusy } from '../send-status'
import { sessionManager } from '../session-manager'
import { storageService } from '../storage/storage-service'
import { SendSuspendedError } from '../transaction-service'
import type { useAccount } from './useAccount'
import { amountText, isAlreadyReceived, receiveMeta, receiving } from './useIncoming'
import type { useNetwork } from './useNetwork'
import { useAutoReceiveSetting } from './useAutoReceiveSetting'
import { useTransaction } from './useTransaction'
import type { useWallet } from './useWallet'

const PROGRESS_TOAST_ID = 'auto-receive'
const FAILED_TOAST_ID = 'auto-receive-failed'
const FAILED_TOAST_MS = 15_000
const PAUSED_TOAST_ID = 'auto-receive-paused'

class AutoReceiveStoppedError extends Error {
  constructor() {
    super('Auto-receive stopped before publishing. Nothing was sent.')
    this.name = 'AutoReceiveStoppedError'
  }
}

type Outcome =
  | 'done'
  | 'idle'
  | 'refused'
  | 'busy'
  | 'stopped'
  | { failed: string }
  | { pausedUntil: number }

interface Progress {
  epoch: number
  amount: string
  symbol: string
  position: number
  total: number
}

function progressText(progress: Progress, withPow: boolean): string {
  const count = progress.total > 1 ? ` (${progress.position} of ${progress.total})` : ''
  const pow = withPow ? ' · generating PoW' : ''
  return `Auto-receiving ${progress.amount} ${progress.symbol}${count}${pow}`
}

/** Receives for the active account while eligible. Returns the stop function. */
export function startAutoReceive(deps: {
  wallet: Pick<
    ReturnType<typeof useWallet>,
    'activeWallet' | 'activeAccountAddress' | 'isActiveWalletUnlocked'
  >
  account: Pick<ReturnType<typeof useAccount>, 'unreceivedCount' | 'loadUnreceivedCount'>
  network: Pick<
    ReturnType<typeof useNetwork>,
    'isConnected' | 'nodeDown' | 'chainId' | 'currentNode'
  >
}): () => void {
  const setting = useAutoReceiveSetting()
  const transaction = useTransaction()
  const { toast } = useToast()

  let epoch = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let rekick = false
  let retryAt = 0
  let failures = 0
  let failureShown = false
  let warnedNoLocks = false
  let progress: Progress | null = null
  let pauseShown = false
  // Sends the node listed but refused as already received, skipped for the run.
  const refused = new Set<string>()

  const runKey = computed(() => {
    const active = deps.wallet.activeWallet.value
    const address = deps.wallet.activeAccountAddress.value
    if (!setting.enabled.value || !active || !address) return null
    if (!deps.wallet.isActiveWalletUnlocked.value) return null
    if (!deps.network.isConnected.value || deps.network.nodeDown.value) return null
    return `${active.baseAddress}|${address}|${deps.network.chainId.value}|${deps.network.currentNode.value}`
  })

  function showProgress(): void {
    if (!progress || progress.epoch !== epoch) return
    toast.loading(progressText(progress, isGeneratingPow.value), { id: PROGRESS_TOAST_ID })
  }

  function clearProgress(): void {
    progress = null
    toast.dismiss(PROGRESS_TOAST_ID)
  }

  function stopRun(): void {
    epoch++
    if (timer !== null) clearTimeout(timer)
    timer = null
    rekick = false
    clearProgress()
  }

  async function readPowTimes(): Promise<number[]> {
    const stored = await storageService.get(STORAGE_KEY_AUTO_RECEIVE_POW)
    const now = Date.now()
    if (!Array.isArray(stored)) return []
    return stored.filter(
      (t): t is number => typeof t === 'number' && t <= now && now - t < AUTO_RECEIVE_POW_WINDOW_MS
    )
  }

  async function writePowTimes(times: number[]): Promise<void> {
    try {
      await storageService.set(STORAGE_KEY_AUTO_RECEIVE_POW, times)
    } catch (err) {
      console.warn('Could not save the auto-receive PoW times.', err)
    }
  }

  function kick(): void {
    if (disposed || runKey.value === null) return
    if (running) {
      rekick = true
      return
    }
    if (timer !== null) clearTimeout(timer)
    const runEpoch = epoch
    timer = setTimeout(
      () => {
        timer = null
        void runPass(runEpoch)
      },
      Math.max(0, retryAt - Date.now())
    )
  }

  async function runPass(passEpoch: number): Promise<void> {
    if (passEpoch !== epoch || disposed) return
    running = true
    let outcome: Outcome
    try {
      outcome = await lockedPass(passEpoch)
    } catch (err) {
      outcome = { failed: err instanceof Error ? err.message : 'Failed to receive' }
    } finally {
      running = false
    }
    if (passEpoch === epoch && !disposed) settle(outcome)
    if (rekick) {
      rekick = false
      kick()
    }
  }

  function settle(outcome: Outcome): void {
    if (outcome === 'stopped') return
    if (outcome === 'busy') {
      retryAt = Date.now() + AUTO_RECEIVE_RETRY_MS
    } else if (outcome === 'refused') {
      void deps.account.loadUnreceivedCount()
      return
    } else if (typeof outcome === 'object' && 'pausedUntil' in outcome) {
      retryAt = outcome.pausedUntil
      void deps.account.loadUnreceivedCount()
      if (!pauseShown) {
        pauseShown = true
        toast.info('Auto-receive paused: too many receives needing PoW. It resumes shortly.', {
          id: PAUSED_TOAST_ID,
        })
      }
    } else if (typeof outcome === 'object') {
      failures++
      const delay = Math.min(
        AUTO_RECEIVE_RETRY_MS * 2 ** (failures - 1),
        AUTO_RECEIVE_MAX_BACKOFF_MS
      )
      retryAt = Date.now() + delay
      if (!failureShown) {
        failureShown = true
        toast.error(`Auto-receive failed: ${outcome.failed}`, {
          id: FAILED_TOAST_ID,
          duration: FAILED_TOAST_MS,
        })
      }
    } else {
      retryAt = 0
      failures = 0
      failureShown = false
      if (outcome === 'idle') return
      void deps.account.loadUnreceivedCount()
    }
    kick()
  }

  async function lockedPass(passEpoch: number): Promise<Outcome> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      if (!warnedNoLocks) {
        warnedNoLocks = true
        console.warn('Auto-receive needs Web Locks, which this browser lacks.')
      }
      return 'stopped'
    }
    return locks.request(AUTO_RECEIVE_LOCK, { ifAvailable: true }, async (lock) => {
      if (!lock) return 'busy'
      try {
        return await pass(passEpoch)
      } finally {
        if (passEpoch === epoch) clearProgress()
      }
    })
  }

  async function pass(passEpoch: number): Promise<Outcome> {
    const stale = (): boolean => passEpoch !== epoch
    if (stale()) return 'stopped'
    if (isSendBusy.value) return 'busy'
    const active = deps.wallet.activeWallet.value
    const address = deps.wallet.activeAccountAddress.value
    if (!active || !address) return 'stopped'

    const service = AccountService.getInstance()
    const info = await service.getAccountInfo(address)
    if (stale() || !sessionManager.isUnlocked(active.baseAddress)) return 'stopped'
    const held = new Set<string>([ZNN_ZTS.toString(), QSR_ZTS.toString()])
    for (const [zts, entry] of Object.entries(info?.balanceInfoMap ?? {})) {
      if (BigInt(entry.balance.toString()) > 0n) held.add(zts)
    }

    const receivableSymbol = (block: AccountBlock): string | null => {
      const standard = block.tokenStandard.toString()
      if (!held.has(standard)) return null
      if (block.token) return block.token.symbol
      if (standard === ZNN_ZTS.toString()) return 'ZNN'
      if (standard === QSR_ZTS.toString()) return 'QSR'
      return null
    }

    const kept: AccountBlock[] = []
    for (let page = 0; page < AUTO_RECEIVE_MAX_PAGES; page++) {
      const result = await service.getUnreceivedBlocks(address, page, AUTO_RECEIVE_PAGE_SIZE)
      if (stale()) return 'stopped'
      for (const block of result.list) {
        const hash = block.hash.toString()
        if (receivableSymbol(block) !== null && !receiving.has(hash) && !refused.has(hash)) {
          kept.push(block)
        }
      }
      if (result.list.length < AUTO_RECEIVE_PAGE_SIZE) break
    }
    if (kept.length === 0) return 'idle'

    const beforePublish = (): void => {
      if (stale() || !sessionManager.isUnlocked(active.baseAddress)) {
        throw new AutoReceiveStoppedError()
      }
    }

    let powTimes = await readPowTimes()
    if (stale()) return 'stopped'
    let received = 0
    let skipped = 0
    for (const [index, block] of kept.entries()) {
      if (stale() || !sessionManager.isUnlocked(active.baseAddress)) return 'stopped'
      if (isSendBusy.value) return 'busy'
      // The node's own difficulty for this receive decides whether PoW runs.
      const needsPow = (await service.getRequiredPoWForReceive(address)) > 0
      if (stale()) return 'stopped'
      if (needsPow && powTimes.length >= AUTO_RECEIVE_POW_LIMIT) {
        return { pausedUntil: Math.min(...powTimes) + AUTO_RECEIVE_POW_WINDOW_MS }
      }
      const hash = block.hash.toString()
      if (receiving.has(hash)) continue
      const symbol = receivableSymbol(block)
      if (symbol === null) continue
      const amount = amountText(block)
      progress = {
        epoch: passEpoch,
        amount,
        symbol,
        position: index + 1,
        total: kept.length,
      }
      const text = progressText(progress, false)
      showProgress()
      receiving.add(hash)
      try {
        // Counted before PoW starts, so a refused, failed or stopped run
        // still counts, in the worker and in the main-thread fallback.
        if (needsPow) {
          powTimes = [...powTimes, Date.now()]
          await writePowTimes(powTimes)
        }
        await transaction.receiveTransaction(
          active,
          address,
          hash,
          { ...receiveMeta(block, `Auto-receive ${amount} ${symbol}`, text), background: true },
          beforePublish
        )
        received++
        pauseShown = false
      } catch (err) {
        if (err instanceof AutoReceiveStoppedError || err instanceof SendSuspendedError) {
          return 'stopped'
        }
        if (isAlreadyReceived(err)) {
          refused.add(hash)
          skipped++
          continue
        }
        if (stale()) return 'stopped'
        return { failed: err instanceof Error ? err.message : 'Failed to receive' }
      } finally {
        receiving.delete(hash)
      }
    }
    if (received > 0) return 'done'
    return skipped > 0 ? 'refused' : 'idle'
  }

  const stopKeyWatch = watch(
    runKey,
    (key) => {
      stopRun()
      refused.clear()
      pauseShown = false
      if (key === null) return
      retryAt = 0
      failures = 0
      failureShown = false
      kick()
    },
    { flush: 'sync', immediate: true }
  )
  const stopCountWatch = watch(
    () => deps.account.unreceivedCount.value,
    (count) => {
      if (count > 0) kick()
    }
  )
  const stopPowWatch = watch(isGeneratingPow, showProgress)

  return () => {
    if (disposed) return
    disposed = true
    stopKeyWatch()
    stopCountWatch()
    stopPowWatch()
    stopRun()
  }
}

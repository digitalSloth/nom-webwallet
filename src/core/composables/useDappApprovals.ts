import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import {
  approvalQueue,
  dequeueApproval,
  getHandlers,
  type ApprovalHandlers,
  type PendingApproval,
} from '../dapp-approvals'
import { sessionManager } from '../session-manager'
import { signMessage } from '../message-signing'
import { InvalidParamsError } from '../message-guard'
import { TransactionService } from '../transaction-service'
import { readPersistedChainId } from '../zenon-service'
import { STORAGE_KEY_WALLETS } from '@/config'
import { useWallet } from './useWallet'
import { runActivity } from './useActivity'

// Module-level reactive state — shared across every useDappApprovals() caller
const isBusy = ref(false)

/** What the dialog must tell the user after the last approve() call. */
export type ApproveNotice = 'accountChanged' | 'needsUnlock' | null
const notice = ref<ApproveNotice>(null)

const currentApproval = computed<PendingApproval | null>(() => approvalQueue.value[0] ?? null)
const pendingCount = computed(() => approvalQueue.value.length)

/**
 * Settles a pending approval exactly once. A handler failure — relay I/O from
 * phase 2 onward — is logged and swallowed rather than retried as a second
 * `handlers.reject` call; the approval is dequeued regardless of outcome.
 */
async function settle(id: string, call: () => Promise<void>): Promise<void> {
  try {
    await call()
  } catch (err) {
    console.error('dApp approval handler failed', err)
  } finally {
    dequeueApproval(id)
  }
}

/**
 * The approval window keeps its own wallet copy. This reloads it when
 * another window switches the wallet or account, so the lock state, the
 * unlock prompt and the mismatch warning follow the wallet that will sign.
 * The binding stays on `approval.account`.
 */
export function watchWalletStorage(): () => void {
  const wallet = useWallet()
  const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (
    changes,
    areaName
  ) => {
    if (areaName === 'local' && STORAGE_KEY_WALLETS in changes) void wallet.loadWalletData()
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export function useDappApprovals(): {
  approvals: ComputedRef<PendingApproval[]>
  currentApproval: ComputedRef<PendingApproval | null>
  pendingCount: ComputedRef<number>
  isBusy: Ref<boolean>
  notice: Ref<ApproveNotice>
  accountMismatch: ComputedRef<boolean>
  approve(id: string): Promise<void>
  reject(id: string): Promise<void>
} {
  const wallet = useWallet()

  const accountMismatch = computed(() => {
    const approval = currentApproval.value
    const active = wallet.activeAccountAddress.value
    return approval !== null && active !== null && active !== approval.account
  })

  // `id` is the approval the caller saw rendered when the click happened. If
  // the queue head has since moved on — the previous head settled between the
  // click and this call — this is a no-op rather than acting on whatever is
  // now current, so a click can never approve/reject a different request
  // than the one on screen when it was made.
  async function approve(id: string): Promise<void> {
    notice.value = null
    const approval = currentApproval.value
    if (!approval || approval.id !== id || isBusy.value) return

    isBusy.value = true
    try {
      // Guard: expiry. Responding to an expired request is worse than silence.
      if (approval.expiresAt !== undefined && approval.expiresAt <= Date.now()) {
        dequeueApproval(approval.id)
        return
      }

      // Guard: missing handlers. Fetched before any handler.reject call below,
      // so an entry with no handlers cannot wedge the head of the queue.
      const handlers: ApprovalHandlers | undefined = getHandlers(approval.id)
      if (!handlers) {
        dequeueApproval(approval.id)
        return
      }

      // Re-read storage rather than trusting this window's copy: another
      // window may have switched the active account or chain since this one
      // loaded, and the dApp has already been told about that switch.
      const [, chainId] = await Promise.all([wallet.loadWalletData(), readPersistedChainId()])
      const activeWallet = wallet.activeWallet.value
      const activeAddress = wallet.activeAccountAddress.value
      const account = activeWallet?.accounts.find((acc) => acc.address === activeAddress)

      if (!activeWallet || !activeAddress || !account) {
        await settle(approval.id, () => handlers.reject({ reason: 'walletLocked' }))
        return
      }

      // Guard: binding. The approval signs only with the account and chain
      // it was shown with. Everything below signs with the locals read
      // above (activeWallet, account), never with the wallet refs: the
      // storage listener can reload those refs at any await.
      if (account.address !== approval.account || chainId !== approval.chainId) {
        notice.value = 'accountChanged'
        await settle(approval.id, () => handlers.reject({ reason: 'accountChanged' }))
        return
      }

      if (approval.action.kind === 'connect') {
        await settle(approval.id, () =>
          handlers.resolve({ kind: 'connect', address: account.address })
        )
        return
      }

      // Guard: locked wallet, for signMessage and sendBlock only. The active
      // wallet has no session in this window (a session timeout, or a wallet
      // switch that landed after the last refresh), so this keeps the request
      // and reports needsUnlock. The dialog opens the unlock prompt for the
      // active wallet.
      const keyStore = sessionManager.getKeyStore(activeWallet.baseAddress)
      if (!keyStore) {
        notice.value = 'needsUnlock'
        return
      }
      const keyPair = keyStore.getKeyPair(account.index)
      const action = approval.action

      try {
        if (action.kind === 'signMessage') {
          const { message } = action
          const { signature, publicKey } = signMessage(message, keyPair)
          await settle(approval.id, () =>
            handlers.resolve({
              kind: 'signMessage',
              message,
              address: account.address,
              publicKey,
              signature,
            })
          )
        } else {
          const sent = await runActivity('Sending dApp transaction', () =>
            TransactionService.getInstance().sendEmbeddedContractBlock(action.block, keyPair)
          )
          await settle(approval.id, () => handlers.resolve({ kind: 'sendBlock', block: sent }))
        }
      } catch (err) {
        if (err instanceof InvalidParamsError) {
          await settle(approval.id, () =>
            handlers.reject({ reason: 'invalidParams', detail: err.message })
          )
        } else {
          const detail = err instanceof Error ? err.message : 'Failed to send.'
          await settle(approval.id, () => handlers.reject({ reason: 'sendFailed', detail }))
        }
      }
    } finally {
      isBusy.value = false
    }
  }

  async function reject(id: string): Promise<void> {
    notice.value = null
    const approval = currentApproval.value
    if (!approval || approval.id !== id || isBusy.value) return

    isBusy.value = true
    try {
      if (approval.expiresAt !== undefined && approval.expiresAt <= Date.now()) {
        dequeueApproval(approval.id)
        return
      }

      const handlers = getHandlers(approval.id)
      if (!handlers) {
        dequeueApproval(approval.id)
        return
      }

      await settle(approval.id, () => handlers.reject({ reason: 'userRejected' }))
    } finally {
      isBusy.value = false
    }
  }

  return {
    approvals: approvalQueue,
    currentApproval,
    pendingCount,
    isBusy,
    notice,
    accountMismatch,
    approve,
    reject,
  }
}

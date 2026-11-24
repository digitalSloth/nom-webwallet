import { computed, onScopeDispose, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useToast } from 'nom-ui'
import { useDappApprovals } from './useDappApprovals'
import { useStickyToast } from './useStickyToast'
import { useUnlockTarget } from './useUnlockTarget'
import type { UnlockTarget } from './useUnlockTarget'
import { useWallet } from './useWallet'

export interface ApprovalControls {
  password: Ref<string>
  unlockError: Ref<string | null>
  isUnlocking: Ref<boolean>
  unlockTarget: Ref<UnlockTarget | null>
  actionsDisabled: ComputedRef<boolean>
  handlePrimary(): Promise<{ kind: 'sendBlock'; hash: string } | null>
  handleReject(): void
  restartCooldown(): void
}

// A rapid double-click can still land on newly-rendered content: Vue's
// scheduler updates `renderedApprovalId` and clears `isBusy` inside the same
// microtask checkpoint that dequeues the previous approval, with no yield to
// the event loop in between. A second click arrives at least a full task
// later (user input is never synchronous with a microtask drain), so by then
// the id guard already matches the *new* head and would let the click
// through. `justChanged` blocks both buttons for a short window after every
// id change so the user has had a moment to actually see what they're
// approving before a click can register.
const COOLDOWN_MS = 750

/**
 * The approve and reject controls of a dApp approval screen: the inline
 * unlock, the click-time request id and the cooldown after a request
 * changes. Set it up before any approval can be queued, because the
 * rendered id only follows head changes.
 */
export function useApprovalControls(options?: { onNeedsUnlock?: () => void }): ApprovalControls {
  const wallet = useWallet()
  const toast = useToast()
  const refusalToast = useStickyToast(toast.toast)
  const { isBusy, notice, needsUnlockPrompt, currentApproval, approve, reject } = useDappApprovals()

  // --- Inline unlock: the password goes on the approval screen, so approving a request
  // on a locked wallet is one step rather than a detour through the unlock
  // prompt. The target wallet is pinned while the field is shown, so a password
  // typed for one wallet is never submitted against another.
  const password = ref('')
  const unlockError = ref<string | null>(null)
  const isUnlocking = ref(false)
  const { unlockTarget, pinActiveWallet } = useUnlockTarget(() => {
    password.value = ''
    unlockError.value = null
    if (needsUnlockPrompt.value) pinActiveWallet()
  })

  watch(
    needsUnlockPrompt,
    (needed) => {
      if (needed) {
        pinActiveWallet()
      } else {
        password.value = ''
        unlockError.value = null
      }
    },
    { immediate: true }
  )

  watch(password, () => {
    unlockError.value = null
  })

  // Updated only after the DOM has repainted for a new currentApproval, so it
  // always matches what the user can actually see, even during the moment
  // between one approval settling and the next one's body finishing its
  // render. Approve/Reject act on this id, never on whatever the queue head
  // happens to be when the click is handled.
  const renderedApprovalId = ref<string | null>(null)

  const justChanged = ref(false)
  let cooldownTimer: ReturnType<typeof setTimeout> | null = null

  function startCooldown(): void {
    if (cooldownTimer) clearTimeout(cooldownTimer)
    justChanged.value = true
    cooldownTimer = setTimeout(() => {
      justChanged.value = false
      cooldownTimer = null
    }, COOLDOWN_MS)
  }

  watch(
    currentApproval,
    (val) => {
      renderedApprovalId.value = val?.id ?? null
      startCooldown()
    },
    { flush: 'post' }
  )

  onScopeDispose(() => {
    if (cooldownTimer) clearTimeout(cooldownTimer)
  })

  const actionsDisabled = computed(() => isBusy.value || justChanged.value || isUnlocking.value)

  async function handlePrimary(): Promise<{ kind: 'sendBlock'; hash: string } | null> {
    if (actionsDisabled.value) return null
    refusalToast.dismiss()
    // Captured at the click, so the unlock and the approve both act on the
    // request that was on screen.
    const id = renderedApprovalId.value
    if (!id) return null
    if (needsUnlockPrompt.value) {
      const unlocked = await unlockWithPassword()
      if (!unlocked) return null
    }
    return approveRendered(id)
  }

  async function unlockWithPassword(): Promise<boolean> {
    const target = unlockTarget.value
    if (!target) return false
    if (!password.value) {
      unlockError.value = 'Password is required'
      return false
    }
    isUnlocking.value = true
    try {
      await wallet.unlockWallet(target.baseAddress, password.value)
      password.value = ''
      return true
    } catch (error) {
      unlockError.value =
        error instanceof Error
          ? error.message
          : 'Failed to unlock wallet. Please check your password.'
      return false
    } finally {
      isUnlocking.value = false
    }
  }

  async function approveRendered(id: string): Promise<{ kind: 'sendBlock'; hash: string } | null> {
    const result = await approve(id)
    if (notice.value === 'accountChanged') {
      // Stays on screen until dismissed: the window has nothing else that
      // explains the refusal.
      refusalToast.showError(
        'The active account or network changed after this request was made, so it was rejected. Ask the site to send it again.'
      )
    } else if (notice.value === 'needsUnlock') {
      toast.show('Unlock the wallet to approve this request.', 'warning')
      options?.onNeedsUnlock?.()
    }
    return result
  }

  function handleReject(): void {
    if (actionsDisabled.value) return
    refusalToast.dismiss()
    if (renderedApprovalId.value) reject(renderedApprovalId.value)
  }

  return {
    password,
    unlockError,
    isUnlocking,
    unlockTarget,
    actionsDisabled,
    handlePrimary,
    handleReject,
    restartCooldown: startCooldown,
  }
}

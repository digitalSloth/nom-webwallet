import { computed, onScopeDispose, ref } from 'vue'
import type { IssueParams, TxMeta } from '@/core'
import type { ActionResult } from './contract-action'
import { isPending } from '@/shared/lib/pending-calls'
import { issueMeta, parseIssueForm } from './token-issue'
import type { IssueForm } from './token-issue'

export interface IssueSubmitDeps {
  key: string // `token-issue:${address}`
  address: string | null
  form: () => IssueForm
  znnBalance: () => bigint | null
  run: (from: string, params: IssueParams, meta: TxMeta) => Promise<ActionResult>
  navigate: (hash: string) => Promise<unknown>
}

/**
 * The Issue click flow: the form checks, then the send. `pendingElsewhere`
 * is true when an issue under this key is pending that this page did not
 * start. A page that unmounted before the send finished does not navigate.
 */
export function useIssueSubmit(deps: IssueSubmitDeps) {
  const submitting = ref(false)
  const actionError = ref<{ message: string; timeout: boolean } | null>(null)
  const timedOut = ref(false)
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })

  const busy = computed(() => submitting.value || isPending(deps.key))
  const pendingElsewhere = computed(
    () => isPending(deps.key) && !submitting.value && !timedOut.value
  )

  async function submit(): Promise<void> {
    const from = deps.address
    if (busy.value || !from) return
    submitting.value = true
    actionError.value = null
    try {
      const c = parseIssueForm(deps.form(), deps.znnBalance())
      if (!c.params) return
      const result = await deps.run(from, c.params, issueMeta(c.params))
      if (result.kind === 'sent') {
        submitting.value = false
        if (!disposed) await deps.navigate(result.hash)
      } else if (result.kind === 'error') {
        actionError.value = { message: result.message, timeout: result.timeout }
        timedOut.value = result.timeout
      }
    } finally {
      submitting.value = false
    }
  }

  return { submitting, actionError, busy, pendingElsewhere, submit }
}

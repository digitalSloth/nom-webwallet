import { computed, onScopeDispose, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'
import { TOKEN_CHANGED_MESSAGE } from '@/core/composables/useOwnedTokens'
import type { TxMeta, useOwnedTokens } from '@/core'
import type { BalanceInfo, Wallet } from '@/types'
import type { ActionResult } from './contract-action'
import { isPending } from '@/shared/lib/pending-calls'
import {
  actionKey,
  burnChoices,
  burnMeta,
  checkUpdate,
  heldBalance,
  mintMeta,
  parseBurn,
  parseMint,
  tokenFacts,
  updateMeta,
} from './token-actions'
import type { TokenActionMode, TokenFacts } from './token-actions'

export interface TokenActionDeps {
  mode: TokenActionMode
  address: string // the active account when the dialog opened
  tokenStandard: string | null // null opens the burn picker
  ownAccounts: () => readonly string[]
  balances: () => { list: readonly BalanceInfo[]; loading: boolean }
  tokens: Pick<ReturnType<typeof useOwnedTokens>, 'findToken' | 'mint' | 'burn' | 'update'>
  run: (
    key: string,
    from: string,
    meta: TxMeta,
    send: (wallet: Wallet) => Promise<AccountBlockTemplate>
  ) => Promise<ActionResult>
  onSent: () => void
}

/**
 * The load and submit flow of the token action dialog. `pendingElsewhere`
 * is true when a call under this key is pending that this dialog did not
 * start. A dialog that unmounted before the send finished does not call
 * `onSent`.
 */
export function useTokenAction(deps: TokenActionDeps) {
  const zts = ref<string | null>(deps.tokenStandard)
  const facts = shallowRef<TokenFacts | null>(null)
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const amount = ref('')
  const to = ref(deps.address)
  const owner = ref('')
  const mintable = ref(false)
  const burnable = ref(false)
  const confirmedOwner: Ref<string | null> = ref(null)
  const mintOffConfirmed = ref(false)
  const submitting = ref(false)
  const actionError = ref<{ message: string; timeout: boolean } | null>(null)
  const timedOut = ref(false)
  let latest = 0
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })

  const choices = computed(() => burnChoices(deps.balances().list))
  const balance = computed(() => {
    const b = deps.balances()
    return zts.value === null ? null : heldBalance(b.list, zts.value, b.loading)
  })
  const ctx = () => ({ active: deps.address, ownAccounts: deps.ownAccounts() })

  const mintCheck = computed(() =>
    deps.mode === 'mint' && facts.value
      ? parseMint({ amount: amount.value, to: to.value }, facts.value, ctx())
      : null
  )
  const burnCheck = computed(() =>
    deps.mode === 'burn' && facts.value
      ? parseBurn(amount.value, facts.value, balance.value, deps.address)
      : null
  )
  const updateCheck = computed(() =>
    deps.mode === 'manage' && facts.value
      ? checkUpdate(
          {
            owner: owner.value,
            mintable: mintable.value,
            burnable: burnable.value,
            confirmedOwner: confirmedOwner.value,
            mintOffConfirmed: mintOffConfirmed.value,
          },
          facts.value,
          ctx()
        )
      : null
  )
  const canSubmit = computed(() => {
    if (deps.mode === 'mint') return mintCheck.value?.params != null
    if (deps.mode === 'burn') return burnCheck.value?.params != null
    return updateCheck.value?.ready === true
  })

  const key = computed(() =>
    zts.value === null ? null : actionKey(deps.mode, deps.address, zts.value)
  )
  const busy = computed(() => submitting.value || (key.value !== null && isPending(key.value)))
  const pendingElsewhere = computed(
    () => key.value !== null && isPending(key.value) && !submitting.value && !timedOut.value
  )

  async function load(): Promise<void> {
    const target = zts.value
    if (target === null) return
    const gen = ++latest
    loading.value = true
    loadError.value = null
    try {
      const token = await deps.tokens.findToken(target)
      if (gen !== latest) return
      if (!token) {
        facts.value = null
        loadError.value = "This token doesn't exist on this network."
        return
      }
      const read = tokenFacts(token)
      facts.value = read
      if (deps.mode === 'manage') {
        owner.value = read.owner
        mintable.value = read.isMintable
        burnable.value = read.isBurnable
        confirmedOwner.value = null
        mintOffConfirmed.value = false
      }
    } catch (err) {
      if (gen !== latest) return
      facts.value = null
      loadError.value =
        err instanceof Error && err.message ? err.message : "Couldn't read this token"
    } finally {
      if (gen === latest) loading.value = false
    }
  }

  function select(next: string): void {
    if (busy.value) return
    zts.value = next
    facts.value = null
    amount.value = ''
    actionError.value = null
    void load()
  }

  function setMintable(value: boolean): void {
    mintable.value = value
    if (value) mintOffConfirmed.value = false
  }

  async function submit(): Promise<void> {
    const read = facts.value
    const k = key.value
    if (busy.value || !read || k === null || !canSubmit.value) return
    const from = deps.address
    submitting.value = true
    actionError.value = null
    try {
      let meta: TxMeta
      let send: (wallet: Wallet) => Promise<AccountBlockTemplate>
      if (deps.mode === 'mint') {
        const params = mintCheck.value?.params
        if (!params) return
        meta = mintMeta(params, read)
        send = (w) => deps.tokens.mint(w, from, params, meta)
      } else if (deps.mode === 'burn') {
        const params = burnCheck.value?.params
        if (!params) return
        meta = burnMeta(params, read)
        send = (w) => deps.tokens.burn(w, from, params, meta)
      } else {
        const params = updateCheck.value?.params
        if (!params) return
        meta = updateMeta(params, read)
        const loaded = { owner: read.owner, mintable: read.isMintable, burnable: read.isBurnable }
        send = (w) => deps.tokens.update(w, from, params, loaded, meta)
      }
      const result = await deps.run(k, from, meta, send)
      if (result.kind === 'sent') {
        submitting.value = false
        if (!disposed) deps.onSent()
      } else if (result.kind === 'error') {
        actionError.value = { message: result.message, timeout: result.timeout }
        timedOut.value = result.timeout
        if (result.message === TOKEN_CHANGED_MESSAGE) await load()
      }
    } finally {
      submitting.value = false
    }
  }

  if (deps.tokenStandard !== null) void load()

  return {
    zts,
    facts,
    loading,
    loadError,
    choices,
    balance,
    amount,
    to,
    owner,
    mintable,
    burnable,
    confirmedOwner,
    mintOffConfirmed,
    mintCheck,
    burnCheck,
    updateCheck,
    canSubmit,
    key,
    submitting,
    actionError,
    busy,
    pendingElsewhere,
    select,
    load,
    setMintable,
    submit,
  }
}

import { ref } from 'vue'
import type { RouteRecordNameGeneric } from 'vue-router'
import type { TxMeta } from '@/core/send-recorder'
import { parseAmount } from './amount'

export interface SendDraft {
  tokenStandard: string
  symbol: string
  decimals: number
  /** Normalised by formatAmount. */
  amount: string
  /** Trimmed. */
  recipient: string
  /** The account the draft was reviewed for. */
  from: string
}

/** The send being composed, shared by Send and Review. */
export const sendDraft = ref<SendDraft | null>(null)

/** Raw Send form fields kept while the user visits another screen and returns. */
export interface SendFormStash {
  /** The account the form was typed for. */
  address: string
  tokenStandard: string | null
  amount: string
  recipient: string
}

export const sendFormStash = ref<SendFormStash | null>(null)

/** Returns the stash when it belongs to `address`, and always clears it. */
export function takeSendFormStash(address: string | null): SendFormStash | null {
  const stash = sendFormStash.value
  sendFormStash.value = null
  return stash && stash.address === address ? stash : null
}

/**
 * Keeps the Send form for the next Send page when this one unmounts while the
 * route is still Send, as when the web app switches between the small and
 * large layouts. Leaving Send for another page keeps nothing.
 */
export function keepSendForm(
  routeName: RouteRecordNameGeneric | null | undefined,
  form: SendFormStash | null
): void {
  if (routeName === 'send' && form) sendFormStash.value = form
}

/** True when the draft was reviewed for another account than the active one (null counts as another). */
export function senderChanged(
  draft: Pick<SendDraft, 'from'>,
  activeAddress: string | null
): boolean {
  return draft.from !== activeAddress
}

/**
 * The only source of a Confirm's publish arguments: null for no draft or a
 * draft reviewed for another account than the active one.
 */
export function confirmRequest(
  draft: SendDraft | null,
  activeAddress: string | null
): SendRequest | null {
  if (!draft || senderChanged(draft, activeAddress)) return null
  return sendRequest(draft)
}

export interface SendRequest {
  from: string
  recipient: string
  tokenStandard: string
  amount: bigint
  context: TxMeta
}

/** Exactly what Confirm publishes for `draft`; null when `draft.amount` does not parse at `draft.decimals`. */
export function sendRequest(draft: SendDraft): SendRequest | null {
  const amount = parseAmount(draft.amount, draft.decimals)
  if (amount === null) return null
  return {
    from: draft.from,
    recipient: draft.recipient,
    tokenStandard: draft.tokenStandard,
    amount,
    context: {
      kind: 'send',
      title: `Send ${draft.amount} ${draft.symbol}`,
      progress: `Sending ${draft.amount} ${draft.symbol}`,
      amount: amount.toString(),
      decimals: draft.decimals,
      symbol: draft.symbol,
      tokenStandard: draft.tokenStandard,
      recipient: draft.recipient,
    },
  }
}

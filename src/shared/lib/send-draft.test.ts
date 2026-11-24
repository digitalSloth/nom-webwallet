import { afterEach, describe, expect, it } from 'vitest'
import {
  confirmRequest,
  keepSendForm,
  sendDraft,
  sendFormStash,
  senderChanged,
  sendRequest,
  takeSendFormStash,
} from './send-draft'
import type { SendDraft } from './send-draft'

afterEach(() => {
  sendDraft.value = null
  sendFormStash.value = null
})

describe('sendFormStash', () => {
  it('starts empty', () => {
    expect(sendFormStash.value).toBeNull()
  })

  it('keeps the raw form fields until cleared', () => {
    sendFormStash.value = {
      address: 'z1a',
      tokenStandard: 'zts1znnxxxxxxxxxxxxx9z4ulx',
      amount: '1.5',
      recipient: 'z1abc',
    }

    expect(sendFormStash.value.amount).toBe('1.5')
  })

  it('is independent of the send draft', () => {
    sendFormStash.value = { address: 'z1a', tokenStandard: null, amount: '2', recipient: '' }

    expect(sendDraft.value).toBeNull()
  })
})

describe('takeSendFormStash', () => {
  const stash = { address: 'z1a', tokenStandard: null, amount: '3', recipient: 'z1x' }

  it('returns the stash for the same account and clears it', () => {
    sendFormStash.value = stash

    expect(takeSendFormStash('z1a')).toEqual(stash)
    expect(sendFormStash.value).toBeNull()
  })

  it('discards the stash for a different account', () => {
    sendFormStash.value = stash

    expect(takeSendFormStash('z1b')).toBeNull()
    expect(sendFormStash.value).toBeNull()
  })

  it('returns null when nothing is stashed', () => {
    expect(takeSendFormStash('z1a')).toBeNull()
  })
})

describe('keepSendForm', () => {
  const form = { address: 'z1a', tokenStandard: null, amount: '4', recipient: 'z1x' }

  it('keeps the form when Send unmounts on the send route', () => {
    keepSendForm('send', form)

    expect(sendFormStash.value).toEqual(form)
  })

  it('keeps nothing when Send unmounts after leaving for another page', () => {
    keepSendForm('send-review', form)
    keepSendForm(undefined, form)

    expect(sendFormStash.value).toBeNull()
  })

  it('keeps nothing without a form', () => {
    keepSendForm('send', null)

    expect(sendFormStash.value).toBeNull()
  })
})

describe('send form across a layout flip', () => {
  const form = { address: 'z1a', tokenStandard: 'zts1x', amount: '4', recipient: 'z1x' }

  it('hands the kept form to the next Send page of the same account once', () => {
    keepSendForm('send', form)

    expect(takeSendFormStash('z1a')).toEqual(form)
    expect(takeSendFormStash('z1a')).toBeNull()
  })

  it('does not hand the kept form to another account', () => {
    keepSendForm('send', form)

    expect(takeSendFormStash('z1b')).toBeNull()
  })
})

describe('senderChanged', () => {
  it('is true for another address and for null', () => {
    expect(senderChanged({ from: 'z1a' }, 'z1b')).toBe(true)
    expect(senderChanged({ from: 'z1a' }, null)).toBe(true)
  })

  it('is false for the same address', () => {
    expect(senderChanged({ from: 'z1a' }, 'z1a')).toBe(false)
  })
})

describe('sendRequest', () => {
  const draft: SendDraft = {
    tokenStandard: 'zts1qsr',
    symbol: 'QSR',
    decimals: 8,
    amount: '0.12345678',
    recipient: 'z1to',
    from: 'z1from',
  }

  it('carries the reviewed amount, recipient, token and sender', () => {
    const req = sendRequest(draft)

    expect(req).toMatchObject({
      from: 'z1from',
      recipient: 'z1to',
      tokenStandard: 'zts1qsr',
      amount: 12345678n,
    })
    expect(req?.context).toMatchObject({
      kind: 'send',
      title: 'Send 0.12345678 QSR',
      progress: 'Sending 0.12345678 QSR',
      amount: '12345678',
      decimals: 8,
      symbol: 'QSR',
      tokenStandard: 'zts1qsr',
      recipient: 'z1to',
    })
  })

  it('returns null for an amount with too many decimals', () => {
    expect(sendRequest({ ...draft, amount: '0.123456789' })).toBeNull()
  })
})

describe('confirmRequest', () => {
  const draft: SendDraft = {
    tokenStandard: 'zts1qsr',
    symbol: 'QSR',
    decimals: 8,
    amount: '1.5',
    recipient: 'z1to',
    from: 'z1from',
  }

  it('returns null without a draft', () => {
    expect(confirmRequest(null, 'z1from')).toBeNull()
  })

  it('returns null when the active account is not the reviewed one', () => {
    expect(confirmRequest(draft, 'z1other')).toBeNull()
  })

  it('returns null when no account is active', () => {
    expect(confirmRequest(draft, null)).toBeNull()
  })

  it('returns the send request for the reviewed account', () => {
    expect(confirmRequest(draft, 'z1from')).toEqual(sendRequest(draft))
  })
})

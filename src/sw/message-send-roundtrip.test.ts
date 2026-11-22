import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyStore } from 'znn-typescript-sdk'

import type { ApprovalAction } from '@/core/dapp-approvals'
import { encryptedMessageRequest, envelopeLength } from '@/core/message-envelope'
import { sealMessageBlock } from '@/core/message-send'
import { installFakeChrome } from '@/test/fake-chrome'
import { OTHER_ENTROPY, TEST_ENTROPY, testAccount, walletStorage } from '@/test/message-account'

const ORIGIN = 'https://dapp.example'

let env: ReturnType<typeof installFakeChrome>
let decrypt: typeof import('@/sw/message-decrypt')
let permissions: typeof import('@/core/site-permissions')

beforeEach(async () => {
  vi.resetModules()
  env = installFakeChrome()
  decrypt = await import('@/sw/message-decrypt')
  permissions = await import('@/core/site-permissions')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Unlocks the wallet of `entropy` with its first account active, granted to the origin. */
async function openWallet(entropy: string) {
  const account = testAccount(entropy, 0)
  env.local.data['nom-wallet-storage'] = walletStorage(entropy, [0], 0)
  env.session.data['nom-wallet.key:' + account.address] = entropy
  env.session.data['nom-wallet.lastActivityAt'] = Date.now()
  await permissions.grant(ORIGIN)
  await permissions.grantMessages(ORIGIN, account.address)
}

describe('send then decrypt', () => {
  const senderKeys = KeyStore.fromEntropy(TEST_ENTROPY).getKeyPair(0)
  const recipientKeys = KeyStore.fromEntropy(OTHER_ENTROPY).getKeyPair(0)
  const params = {
    to: recipientKeys.address.toString(),
    publicKey: recipientKeys.publicKey.toString('hex'),
    body: 'Hello B \u{1F600}',
    replyTo: 'ab'.repeat(32),
  }

  function sealed() {
    const { to, publicKey, content } = encryptedMessageRequest(params)
    const action: ApprovalAction = {
      kind: 'sendMessage',
      to,
      recipientPublicKey: publicKey,
      content,
      envelopeBytes: envelopeLength(content),
    }
    const block = sealMessageBlock(
      action as Extract<ApprovalAction, { kind: 'sendMessage' }>,
      senderKeys,
      1
    )
    return { block, data: Buffer.from(block.data).toString('base64'), content }
  }

  it('opens as the recipient', async () => {
    const { data, content } = sealed()
    await openWallet(OTHER_ENTROPY)

    const outcome = await decrypt.decryptForOrigin(ORIGIN, [
      { data, publicKey: senderKeys.publicKey.toString('hex'), outgoing: false },
    ])

    expect(outcome).toEqual({ result: [{ ok: true, ...content }] })
  })

  it('opens as the sender', async () => {
    const { data, content } = sealed()
    await openWallet(TEST_ENTROPY)

    const outcome = await decrypt.decryptForOrigin(ORIGIN, [
      { data, publicKey: recipientKeys.publicKey.toString('hex'), outgoing: true },
    ])

    expect(outcome).toEqual({ result: [{ ok: true, ...content }] })
  })

  it('does not open as the sender with the wrong direction', async () => {
    const { data } = sealed()
    await openWallet(TEST_ENTROPY)

    const outcome = await decrypt.decryptForOrigin(ORIGIN, [
      { data, publicKey: recipientKeys.publicKey.toString('hex'), outgoing: false },
    ])

    expect(outcome).toEqual({ result: [{ ok: false, reason: 'unreadable' }] })
  })

  it('carries the envelope in a ZNN send block of amount 0 that starts with the marker', () => {
    const { block, data } = sealed()

    expect(block.amount).toBe(0n)
    expect(block.toAddress.toString()).toBe(params.to)
    expect(data.startsWith('/3pt')).toBe(true)
  })
})

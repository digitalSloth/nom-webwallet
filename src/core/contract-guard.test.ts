import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hash, QSR_ZTS, TokenStandard, Zenon, ZNN_ZTS } from 'znn-typescript-sdk'
import type { AccountBlockTemplate } from 'znn-typescript-sdk'

vi.mock('@/core/zenon-service', () => ({ ZenonService: { getInstance: () => ({}) } }))

import {
  SEND_ABANDONED_DEADLINE_MS,
  SEND_HEARTBEAT_MS,
  SEND_STALE_MS,
  SEND_TIMEOUT_MS,
} from '@/config'
import { assertNoUnresolvedCall } from './contract-guard'
import { createLocalSendRecorder, localInterruptedSource } from './local-send-recorder'
import type { SendRecord } from './send-record'
import { getSendRecorder, setSendRecorder } from './send-recorder'
import { TransactionService } from './transaction-service'
import { createMemorySendRecordStore } from './storage/send-record-store'
import type { SendRecordStore } from './storage/send-record-store'

const FROM = 'z1qqjnwjjpnue8xmmpanz6csze6tcmtzzdtfsww7'
const OTHER = 'z1qxemdeddedxplasmaxxxxxxxxxxxxxxxxsctrp'
const ZNN = ZNN_ZTS.toString()
const QSR = QSR_ZTS.toString()
const HASH_A = 'aa'.repeat(32)
const HASH_B = 'bb'.repeat(32)
const embedded = Zenon.getInstance().embedded

let store: SendRecordStore
const previous = getSendRecorder()
let n = 0

// A record as another tab, or a tab before a reload, left it.
async function leave(call: string, over: Partial<SendRecord['context']> = {}): Promise<string> {
  const id = `rec-${n++}`
  await store.put(
    {
      id,
      surface: 'web',
      stage: 'publishing',
      documentId: 'closed-tab',
      hash: HASH_A,
      context: { kind: 'contract', title: 'Token', from: FROM, call, ...over },
      startedAt: 1,
      heartbeatAt: 1,
    },
    { durable: true }
  )
  return id
}

// The call key the guard computes for a block, read from an empty store.
async function keyOf(block: AccountBlockTemplate): Promise<string> {
  const key = await assertNoUnresolvedCall(block, FROM)
  if (!key) throw new Error('block is not guarded')
  return key
}

beforeEach(() => {
  store = createMemorySendRecordStore()
  setSendRecorder(createLocalSendRecorder(store))
})
afterEach(() => setSendRecorder(previous))

describe('assertNoUnresolvedCall', () => {
  it('refuses a burn when a stored record burns the same token from the same account', async () => {
    await leave(await keyOf(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n)))
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(ZNN), 9n), FROM)
    ).rejects.toThrow('A previous burn may still be sending. Check Activity.')
  })

  it('allows the same burn once the record is resolved', async () => {
    const id = await leave(await keyOf(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n)))
    await store.remove(id)
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n), FROM)
    ).resolves.toBeTypeOf('string')
  })

  it('allows a burn of another token, a mint of the same token and another account', async () => {
    const burn = await keyOf(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n))
    await leave(burn)
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(QSR), 1n), FROM)
    ).resolves.toBeTypeOf('string')
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n), OTHER)
    ).resolves.toBeTypeOf('string')
    const to = embedded.token.burnToken(TokenStandard.parse(ZNN), 1n).toAddress
    await expect(
      assertNoUnresolvedCall(embedded.token.mint(TokenStandard.parse(ZNN), 1n, to), FROM)
    ).resolves.toBeTypeOf('string')
  })

  it('guards mint and update by token standard', async () => {
    const to = embedded.token.burnToken(TokenStandard.parse(ZNN), 1n).toAddress
    const minted = embedded.token.mint(TokenStandard.parse(ZNN), 1n, to)
    await leave(await keyOf(minted))
    await expect(assertNoUnresolvedCall(minted, FROM)).rejects.toThrow('previous mint')
    await expect(
      assertNoUnresolvedCall(embedded.token.mint(TokenStandard.parse(QSR), 1n, to), FROM)
    ).resolves.toBeTypeOf('string')

    const updated = embedded.token.updateToken(TokenStandard.parse(ZNN), to, true, true)
    await leave(await keyOf(updated))
    await expect(assertNoUnresolvedCall(updated, FROM)).rejects.toThrow('previous token update')
  })

  it('guards issue by account and method alone', async () => {
    const issue = (symbol: string) =>
      embedded.token.issueToken('A', symbol, '', 1n, 1n, 8, false, false, false)
    await leave(await keyOf(issue('AAA')))
    await expect(assertNoUnresolvedCall(issue('BBB'), FROM)).rejects.toThrow('previous token issue')
    await expect(assertNoUnresolvedCall(issue('BBB'), OTHER)).resolves.toBeTypeOf('string')
  })

  it('guards HTLC unlock and reclaim by id, and proxy calls by method', async () => {
    const reclaim = (id: string) => embedded.htlc.reclaim(Hash.parse(id))
    await leave(await keyOf(reclaim(HASH_A)))
    await expect(assertNoUnresolvedCall(reclaim(HASH_A), FROM)).rejects.toThrow(
      'previous HTLC reclaim'
    )
    await expect(assertNoUnresolvedCall(reclaim(HASH_B), FROM)).resolves.toBeTypeOf('string')

    await leave(await keyOf(embedded.htlc.allowProxyUnlock()))
    await expect(assertNoUnresolvedCall(embedded.htlc.allowProxyUnlock(), FROM)).rejects.toThrow(
      'previous proxy allow'
    )
    await expect(assertNoUnresolvedCall(embedded.htlc.denyProxyUnlock(), FROM)).resolves.toBeTypeOf(
      'string'
    )
  })

  it('does not guard a call outside the list', async () => {
    const send = embedded.plasma.fuse(
      embedded.token.burnToken(TokenStandard.parse(ZNN), 1n).toAddress,
      1n
    )
    await expect(assertNoUnresolvedCall(send, FROM)).resolves.toBeUndefined()
  })

  it('refuses when the stored records cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.list = () => Promise.reject(new Error('idb down'))
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n), FROM)
    ).rejects.toThrow("Couldn't check for earlier sends on this device. Nothing was sent.")
  })

  it('skips the check when the recorder keeps no records', async () => {
    setSendRecorder({ begin: previous.begin, release: previous.release })
    await expect(
      assertNoUnresolvedCall(embedded.token.burnToken(TokenStandard.parse(ZNN), 1n), FROM)
    ).resolves.toBeTypeOf('string')
  })
})

describe('a send that times out', () => {
  const burn = () => embedded.token.burnToken(TokenStandard.parse(ZNN), 1n)
  const prepared = { hash: { toString: () => HASH_A } }
  const guard = () => assertNoUnresolvedCall(burn(), FROM)
  const blocked = 'A previous burn may still be sending. Check Activity.'

  function start(
    prepare: () => Promise<unknown>,
    publish: (b: unknown) => Promise<unknown> = async (b) => b
  ) {
    const service = new TransactionService({
      getZenon: () =>
        ({
          prepareBlock: prepare,
          ledger: { publishRawTransaction: publish },
        }) as never,
      ensureInitialized: async () => {},
    })
    const context = {
      kind: 'contract' as const,
      title: 'Burn',
      from: FROM,
      call: 'Token.Burn:' + ZNN,
    }
    const sent = service.sendEmbeddedContractBlock(burn(), {} as never, undefined, context)
    const timedOut = expect(sent).rejects.toThrow(/did not respond in time/)
    return { sent, timedOut }
  }

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stays blocked for other tabs until the abandoned attempt fails', async () => {
    let fail!: (e: Error) => void
    const { timedOut } = start(() => new Promise((_, reject) => (fail = reject)))
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await timedOut

    await expect(guard()).rejects.toThrow(blocked)

    fail(new Error('pow failed'))
    await vi.advanceTimersByTimeAsync(0)

    await expect(guard()).resolves.toBeTypeOf('string')
  })

  it('stays blocked while the late-published send is untracked, then clears on release', async () => {
    let finish!: (v: unknown) => void
    const { timedOut } = start(() => new Promise((resolve) => (finish = resolve)))
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await timedOut

    finish(prepared)
    await vi.advanceTimersByTimeAsync(SEND_STALE_MS + SEND_HEARTBEAT_MS)

    expect(((await store.list()) as SendRecord[]).map((r) => r.stage)).toEqual(['published'])
    await expect(guard()).rejects.toThrow(blocked)
    const listed = await localInterruptedSource.list(Date.now(), { popupStart: false })
    expect(listed.map((r) => [r.stage, r.hash])).toEqual([['published', HASH_A]])

    await getSendRecorder().release(HASH_A)

    await expect(guard()).resolves.toBeTypeOf('string')
  })

  it('stops the heartbeat of an attempt that never settles, keeps the record and lists it', async () => {
    const { timedOut } = start(
      async () => prepared,
      () => new Promise(() => {})
    )
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS)
    await timedOut
    await expect(guard()).rejects.toThrow(blocked)

    await vi.advanceTimersByTimeAsync(
      SEND_ABANDONED_DEADLINE_MS + SEND_STALE_MS + SEND_HEARTBEAT_MS
    )

    const stored = (await store.list()) as SendRecord[]
    expect(stored.map((r) => [r.stage, r.hash])).toEqual([['publishing', HASH_A]])
    const listed = await localInterruptedSource.list(Date.now(), { popupStart: false })
    expect(listed.map((r) => [r.stage, r.hash])).toEqual([['publishing', HASH_A]])
    await expect(guard()).rejects.toThrow(blocked)
  })
})

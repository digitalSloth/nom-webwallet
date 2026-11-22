import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SESSION_KEY_WALLETCONNECT_COMMAND,
  SESSION_KEY_WALLETCONNECT_PAIR_RESULT as PAIR_RESULT_KEY,
  STORAGE_KEY_WC_SESSION_SUMMARY as SUMMARY_KEY,
} from '@/config'
import { installFakeChrome, settleStorage } from '@/test/fake-chrome'

let fake: ReturnType<typeof installFakeChrome>

const entry = (topic: string, expiry: number) => ({
  topic,
  name: topic,
  url: 'https://dapp.example',
  icon: null,
  expiry,
})
const future = () => Math.floor(Date.now() / 1000) + 3600
const past = () => Math.floor(Date.now() / 1000) - 10

async function load() {
  vi.resetModules()
  const mod = await import('./useWalletConnectSessions')
  return mod.useWalletConnectSessions()
}

beforeEach(() => {
  fake = installFakeChrome({ emitChanges: true })
})

describe('useWalletConnectSessions', () => {
  it('refresh keeps only unexpired entries', async () => {
    fake.local.data[SUMMARY_KEY] = [entry('live', future()), entry('dead', past())]
    const wc = await load()

    await wc.refresh()

    expect(wc.sessions.value.map((s) => s.topic)).toEqual(['live'])
  })

  it('updates sessions when the summary changes in local storage', async () => {
    const wc = await load()

    await fake.local.set({ [SUMMARY_KEY]: [entry('a', future())] })
    await settleStorage()

    expect(wc.sessions.value.map((s) => s.topic)).toEqual(['a'])
  })

  it('ignores a summary change in another area', async () => {
    const wc = await load()

    fake.emitStorageChange({ [SUMMARY_KEY]: { newValue: [entry('a', future())] } }, 'session')

    expect(wc.sessions.value).toEqual([])
  })

  it('a change that arrives while refresh is reading wins over the read result', async () => {
    fake.local.data[SUMMARY_KEY] = [entry('old', future())]
    const wc = await load()

    const reading = wc.refresh()
    fake.emitStorageChange({ [SUMMARY_KEY]: { newValue: [entry('new', future())] } }, 'local')
    await reading

    expect(wc.sessions.value.map((s) => s.topic)).toEqual(['new'])
  })

  it('registers the change listener once across calls', async () => {
    await load()
    const mod = await import('./useWalletConnectSessions')
    mod.useWalletConnectSessions()
    expect(fake.chrome.storage.onChanged.addListener).toHaveBeenCalledTimes(1)
  })

  it('pair trims the uri and stores a pair command', async () => {
    const wc = await load()

    await wc.pair('  wc:abc ')

    expect(fake.session.data[SESSION_KEY_WALLETCONNECT_COMMAND]).toMatchObject({
      kind: 'pair',
      uri: 'wc:abc',
    })
  })

  it('open creates the window without storing a command', async () => {
    const wc = await load()

    await wc.open()

    expect(fake.chrome.windows.create).toHaveBeenCalledTimes(1)
    expect(SESSION_KEY_WALLETCONNECT_COMMAND in fake.session.data).toBe(false)
  })

  it('end and endAll store disconnect commands', async () => {
    const wc = await load()

    await wc.end('t1')
    expect(fake.session.data[SESSION_KEY_WALLETCONNECT_COMMAND]).toMatchObject({
      kind: 'disconnect',
      topic: 't1',
    })

    await wc.endAll()
    expect(fake.session.data[SESSION_KEY_WALLETCONNECT_COMMAND]).toMatchObject({
      kind: 'disconnectAll',
    })
  })

  it('checkPairResult sets pairFailed and removes the key for a failed pair', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'p', ok: false }
    const wc = await load()

    await wc.checkPairResult()

    expect(wc.pairFailed.value).toBe(true)
    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
  })

  it('checkPairResult leaves pairFailed false and removes the key for a good pair', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'p', ok: true }
    const wc = await load()

    await wc.checkPairResult()

    expect(wc.pairFailed.value).toBe(false)
    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
  })

  it('checkPairResult shows a failure only once', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'p', ok: false }
    const wc = await load()
    await wc.checkPairResult()
    wc.clearPairError()

    await wc.checkPairResult()

    expect(wc.pairFailed.value).toBe(false)
  })

  it('checkPairResult changes nothing when no result is stored', async () => {
    const wc = await load()

    await wc.checkPairResult()

    expect(wc.pairFailed.value).toBe(false)
  })

  it('sets pairFailed when the result key changes in the session area', async () => {
    const wc = await load()

    await fake.session.set({ [PAIR_RESULT_KEY]: { id: 'p', ok: false } })
    await settleStorage()

    expect(wc.pairFailed.value).toBe(true)
    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
  })

  it('does not read the result for a session-area change of another key', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'p', ok: false }
    const wc = await load()

    fake.emitStorageChange({ other: { newValue: 1 } }, 'session')
    await settleStorage()

    expect(wc.pairFailed.value).toBe(false)
    expect(fake.session.data[PAIR_RESULT_KEY]).toBeDefined()
  })

  it('does not read the result when the key is removed', async () => {
    const wc = await load()

    fake.emitStorageChange({ [PAIR_RESULT_KEY]: { oldValue: { id: 'p', ok: false } } }, 'session')
    await settleStorage()

    expect(wc.pairFailed.value).toBe(false)
  })

  it('pair clears pairFailed and the stored result before storing the command', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'old', ok: false }
    const wc = await load()
    await wc.checkPairResult()
    fake.session.data[PAIR_RESULT_KEY] = { id: 'old2', ok: false }
    expect(wc.pairFailed.value).toBe(true)

    await wc.pair('wc:abc')

    expect(wc.pairFailed.value).toBe(false)
    expect(PAIR_RESULT_KEY in fake.session.data).toBe(false)
    expect(fake.session.data[SESSION_KEY_WALLETCONNECT_COMMAND]).toMatchObject({ kind: 'pair' })
  })

  it('clearPairError resets pairFailed', async () => {
    fake.session.data[PAIR_RESULT_KEY] = { id: 'p', ok: false }
    const wc = await load()
    await wc.checkPairResult()

    wc.clearPairError()

    expect(wc.pairFailed.value).toBe(false)
  })
})

import { watch, type Ref } from 'vue'
import type { SessionTypes } from '@walletconnect/types'
import {
  SESSION_KEY_WALLETCONNECT_COMMAND,
  SESSION_KEY_WALLETCONNECT_PAIR_RESULT,
  SESSION_KEY_WALLETCONNECT_WINDOW_ID,
  STORAGE_KEY_WC_SESSION_SUMMARY,
} from '@/config'
import type { PeerVerification } from './dapp-approvals'
import { openOrFocusWindow } from './extension-window'
import { createSerialQueue } from './serial-queue'
import { readSessionMeta, type SessionMeta } from './walletconnect-session-meta'

/**
 * Link between the extension popup and the WalletConnect window. The window
 * is the only sign-client host: it publishes a session summary to
 * chrome.storage.local and runs the pair and end commands the popup leaves in
 * chrome.storage.session. The popup imports this module, so it must not pull
 * in the WalletConnect runtime.
 */

export interface WalletConnectSessionSummary {
  topic: string
  name: string
  url: string
  icon: string | null
  /** Seconds, as SessionTypes.Struct.expiry. */
  expiry: number
  verification?: PeerVerification
  approvedAt?: number
}

export type WalletConnectCommandBody =
  | { kind: 'pair'; uri: string }
  | { kind: 'disconnect'; topic: string }
  | { kind: 'disconnectAll' }

export type WalletConnectCommand = { id: string } & WalletConnectCommandBody

export interface WalletConnectPairResult {
  id: string
  ok: boolean
}

export interface WalletConnectHost {
  isEnabled: boolean
  sessions: Readonly<Ref<SessionTypes.Struct[]>>
  initialize(): Promise<void>
  pair(uri: string): Promise<void>
  disconnect(topic: string): Promise<void>
}

const WINDOW_URL_PATH = 'popup.html?surface=window#/walletconnect'
// The outer size includes the title bar; 680 leaves room around the centred
// 360x600 frame.
const WINDOW_SIZE = { width: 420, height: 680 }

/** The unexpired, well-formed entries of a stored summary. */
export function activeSessions(stored: unknown, now: number): WalletConnectSessionSummary[] {
  if (!Array.isArray(stored)) return []
  const result: WalletConnectSessionSummary[] = []
  for (const entry of stored) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    if (typeof item.topic !== 'string' || typeof item.expiry !== 'number') continue
    if (item.expiry * 1000 <= now) continue
    const summary: WalletConnectSessionSummary = {
      topic: item.topic,
      name: typeof item.name === 'string' ? item.name : '',
      url: typeof item.url === 'string' ? item.url : '',
      icon: typeof item.icon === 'string' && item.icon.startsWith('https://') ? item.icon : null,
      expiry: item.expiry,
    }
    if (
      item.verification === 'valid' ||
      item.verification === 'invalid' ||
      item.verification === 'unknown'
    ) {
      summary.verification = item.verification
    }
    if (
      typeof item.approvedAt === 'number' &&
      Number.isFinite(item.approvedAt) &&
      item.approvedAt > 0
    ) {
      summary.approvedAt = item.approvedAt
    }
    result.push(summary)
  }
  return result
}

export async function readSessionSummary(
  now: number = Date.now()
): Promise<WalletConnectSessionSummary[]> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_WC_SESSION_SUMMARY)
  return activeSessions(stored[STORAGE_KEY_WC_SESSION_SUMMARY], now)
}

/** The stored result of the last pair command, or null when absent or malformed. */
export async function readPairResult(): Promise<WalletConnectPairResult | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY_WALLETCONNECT_PAIR_RESULT)
  const value = stored[SESSION_KEY_WALLETCONNECT_PAIR_RESULT]
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.ok !== 'boolean') return null
  return { id: item.id, ok: item.ok }
}

export async function clearPairResult(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY_WALLETCONNECT_PAIR_RESULT)
}

/** Opens the WalletConnect window, or focuses it when it is already open. */
export async function openWalletConnectWindow(): Promise<void> {
  await openOrFocusWindow(
    SESSION_KEY_WALLETCONNECT_WINDOW_ID,
    chrome.runtime.getURL(WINDOW_URL_PATH),
    WINDOW_SIZE
  )
}

/**
 * Leaves a command for the WalletConnect window and opens or focuses it. The
 * write is awaited first: the action popup closes when the window takes
 * focus, so the open step may never resolve here.
 */
export async function sendWalletConnectCommand(body: WalletConnectCommandBody): Promise<void> {
  await chrome.storage.session.set({
    [SESSION_KEY_WALLETCONNECT_COMMAND]: { ...body, id: crypto.randomUUID() },
  })
  await openWalletConnectWindow()
}

function toSummary(session: SessionTypes.Struct, meta?: SessionMeta): WalletConnectSessionSummary {
  const metadata = session.peer.metadata
  const icon = metadata.icons?.[0]
  return {
    topic: session.topic,
    name: metadata.name || 'Unknown dApp',
    url: metadata.url ?? '',
    icon: icon && icon.startsWith('https://') ? icon : null,
    expiry: session.expiry,
    ...(meta ? { verification: meta.verification, approvedAt: meta.approvedAt } : {}),
  }
}

function parseCommand(value: unknown): WalletConnectCommand | null {
  if (typeof value !== 'object' || value === null) return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string') return null
  if (item.kind === 'pair' && typeof item.uri === 'string' && item.uri.startsWith('wc:')) {
    return { id: item.id, kind: 'pair', uri: item.uri }
  }
  if (item.kind === 'disconnect' && typeof item.topic === 'string') {
    return { id: item.id, kind: 'disconnect', topic: item.topic }
  }
  if (item.kind === 'disconnectAll') return { id: item.id, kind: 'disconnectAll' }
  return null
}

/**
 * Runs in the WalletConnect window: publishes the session list and runs the
 * popup's commands. Returns a function that stops it.
 */
export function startWalletConnectHostBridge(host: WalletConnectHost): () => void {
  if (!host.isEnabled) return () => {}

  const handled = new Set<string>()
  let ready = false
  let stopped = false
  let stopWatch: (() => void) | null = null

  // Serial, so the last session list handed in is the one left stored.
  const summaryExclusive = createSerialQueue()

  function writeSummary(list: SessionTypes.Struct[]): void {
    summaryExclusive(async () => {
      let meta: Record<string, SessionMeta> = {}
      try {
        meta = await readSessionMeta()
      } catch (err) {
        console.error('Failed to read the WalletConnect session meta:', err)
      }
      await chrome.storage.local.set({
        [STORAGE_KEY_WC_SESSION_SUMMARY]: list.map((s) => toSummary(s, meta[s.topic])),
      })
    }).catch((err) => console.error('Failed to write the WalletConnect session summary:', err))
  }

  async function writePairResult(result: WalletConnectPairResult): Promise<void> {
    await chrome.storage.session.set({ [SESSION_KEY_WALLETCONNECT_PAIR_RESULT]: result })
  }

  async function run(command: WalletConnectCommand): Promise<void> {
    try {
      if (command.kind === 'pair') {
        try {
          await host.pair(command.uri)
        } catch (err) {
          await writePairResult({ id: command.id, ok: false })
          throw err
        }
        await writePairResult({ id: command.id, ok: true })
      } else if (command.kind === 'disconnect') {
        await host.disconnect(command.topic)
      } else {
        for (const session of [...host.sessions.value]) {
          try {
            await host.disconnect(session.topic)
          } catch (err) {
            console.error('Failed to end a WalletConnect session:', err)
          }
        }
      }
    } catch (err) {
      console.error('WalletConnect command failed:', err)
    }
  }

  async function consume(): Promise<void> {
    try {
      const stored = await chrome.storage.session.get(SESSION_KEY_WALLETCONNECT_COMMAND)
      if (!(SESSION_KEY_WALLETCONNECT_COMMAND in stored)) return
      const command = parseCommand(stored[SESSION_KEY_WALLETCONNECT_COMMAND])
      if (command) {
        if (handled.has(command.id)) return
        handled.add(command.id)
      }
      await chrome.storage.session.remove(SESSION_KEY_WALLETCONNECT_COMMAND)
      if (command) await run(command)
    } catch (err) {
      console.error('Failed to read the WalletConnect command:', err)
    }
  }

  function onChanged(
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ): void {
    if (areaName !== 'session') return
    const change = changes[SESSION_KEY_WALLETCONNECT_COMMAND]
    if (!change || change.newValue === undefined || !ready) return
    void consume()
  }

  // Store this window's id so the next command focuses it even when the
  // popup that opened it closed before it could store the id.
  void (async () => {
    try {
      const current = await chrome.windows.getCurrent()
      if (current.id !== undefined) {
        await chrome.storage.session.set({ [SESSION_KEY_WALLETCONNECT_WINDOW_ID]: current.id })
      }
    } catch (err) {
      console.error('Failed to register the WalletConnect window:', err)
    }
  })()

  chrome.storage.onChanged.addListener(onChanged)

  host.initialize().then(
    () => {
      if (stopped) return
      ready = true
      writeSummary(host.sessions.value)
      stopWatch = watch(host.sessions, writeSummary)
      void consume()
    },
    (err) => console.error('WalletConnect failed to start:', err)
  )

  return () => {
    stopped = true
    ready = false
    stopWatch?.()
    chrome.storage.onChanged.removeListener(onChanged)
  }
}

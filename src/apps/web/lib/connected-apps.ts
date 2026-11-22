import type { SessionTypes } from '@walletconnect/types'
import type { SessionMeta } from '@/core/walletconnect-session-meta'
import type { WalletAccount } from '@/types'
import { shortAddress, urlHost } from '@/shared/lib/format'

export interface SessionRow {
  topic: string
  name: string
  host: string
  initial: string
  accountLabel: string | null
  connectedOn: string | null // d MMM
  verification: {
    text: 'Verified' | 'Unverified'
    tone: 'success' | 'warning' | 'destructive'
  } | null
}

const VERIFICATION = {
  valid: { text: 'Verified', tone: 'success' },
  unknown: { text: 'Unverified', tone: 'warning' },
  invalid: { text: 'Unverified', tone: 'destructive' },
} as const

function accountLabel(
  session: SessionTypes.Struct,
  wallets: readonly { accounts: readonly WalletAccount[] }[]
): string | null {
  const entry = session.namespaces.zenon?.accounts?.[0]
  if (typeof entry !== 'string') return null
  const address = entry.slice(entry.lastIndexOf(':') + 1)
  for (const wallet of wallets) {
    const account = wallet.accounts.find((a) => a.address === address)
    if (account) return account.label || `Account ${account.index + 1}`
  }
  return shortAddress(address)
}

/** One row per session, in session order. Peer fields are untrusted text. */
export function sessionRows(
  sessions: readonly SessionTypes.Struct[],
  meta: Readonly<Record<string, SessionMeta>>,
  wallets: readonly { accounts: readonly WalletAccount[] }[]
): SessionRow[] {
  return sessions.map((session) => {
    const peer = session.peer.metadata as { name?: unknown; url?: unknown }
    const name =
      typeof peer.name === 'string' && peer.name.trim() !== '' ? peer.name.trim() : 'Unknown dApp'
    const sessionMeta = meta[session.topic]
    return {
      topic: session.topic,
      name,
      host: typeof peer.url === 'string' ? urlHost(peer.url) : '',
      initial: String.fromCodePoint(name.codePointAt(0) as number).toUpperCase(),
      accountLabel: accountLabel(session, wallets),
      connectedOn: sessionMeta
        ? new Date(sessionMeta.approvedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })
        : null,
      verification: sessionMeta ? VERIFICATION[sessionMeta.verification] : null,
    }
  })
}

/** The row's detail line: only the parts the session has, joined by " · ". */
export function sessionDetail(row: SessionRow): string {
  return [row.host, row.accountLabel, row.connectedOn && `connected ${row.connectedOn}`]
    .filter(Boolean)
    .join(' · ')
}

import { EXPLORER_URL } from '@/config'
import type { BlockStatus } from '@/core'

export function networkLabel(chainId: number): string {
  return chainId === 1 ? 'Mainnet' : `Chain ${chainId}`
}

export function shortAddress(address: string): string {
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}…${address.slice(-5)}`
}

export function relativeTime(timestampMs: number, now: number = Date.now()): string {
  const diff = now - timestampMs
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`
  const days = Math.floor(diff / 86_400_000)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export function urlHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  unconfirmed: 'Unconfirmed',
  confirmed: 'Confirmed',
  executed: 'Executed',
  failed: 'Failed',
  notReceived: 'Not received yet',
  received: 'Received',
}

export function blockStatusLabel(status: BlockStatus): string {
  return BLOCK_STATUS_LABELS[status]
}

export function blockStatusTone(
  status: BlockStatus
): 'pending' | 'confirming' | 'success' | 'failed' {
  if (status === 'unconfirmed') return 'pending'
  if (status === 'notReceived') return 'confirming'
  if (status === 'failed') return 'failed'
  return 'success'
}

export function explorerBlockUrl(hash: string): string {
  return `${EXPLORER_URL}/block/${hash}`
}

export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_URL}/account/${address}`
}

export function explorerMomentumUrl(hash: string): string {
  return `${EXPLORER_URL}/momentum/${hash}`
}

/** "1 account", "4 accounts", "4 accounts · 1 hidden". */
export function accountCountLabel(accounts: readonly { hidden?: boolean }[]): string {
  const total = accounts.length
  const hidden = accounts.filter((a) => a.hidden).length
  const base = total === 1 ? '1 account' : `${total} accounts`
  return hidden > 0 ? `${base} · ${hidden} hidden` : base
}

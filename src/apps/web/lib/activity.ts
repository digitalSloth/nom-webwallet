const HASH_PATTERN = /^[0-9a-f]{64}$/

/** The trimmed input in lower case when it is 64 hex characters, else null. */
export function parseBlockHash(input: string): string | null {
  const hash = input.trim().toLowerCase()
  return HASH_PATTERN.test(hash) ? hash : null
}

/** "Heights 1,482–1,473 of 1,482" (en dash, en-US grouping). */
export function heightsLabel(range: { from: number; to: number }, total: number): string {
  const n = (value: number) => value.toLocaleString('en-US')
  return `Heights ${n(range.from)}–${n(range.to)} of ${n(total)}`
}

/**
 * The line under a transaction's amount. `ownAccount` names the wallet account
 * that owns `address`, or is null. For a receive block `address` is the
 * receiver, so a foreign one reads "Received by", never "From".
 */
export function txSubline(
  tx: { address: string; meta?: { kind?: string; origin?: string } },
  ownAccount: string | null,
  short: (address: string) => string
): string {
  if (tx.meta?.origin) return `Requested by ${tx.meta.origin}`
  if (ownAccount) return `From ${ownAccount}`
  return tx.meta?.kind === 'receive'
    ? `Received by ${short(tx.address)}`
    : `From ${short(tx.address)}`
}

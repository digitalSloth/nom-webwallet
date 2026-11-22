import { SITE_PERMISSION_TOUCH_INTERVAL_MS, STORAGE_KEY_SITE_PERMISSIONS } from '@/config'
import { createSerialQueue } from './serial-queue'

/**
 * Origin grants for the injected provider (§6.7). A grant covers the
 * read-only methods only — signing and sending prompt every time and are
 * never remembered. No expiry. Every function is a no-op (or returns an
 * empty result) when `!__IS_EXTENSION__`, so the module is inert if it ever
 * reaches the web bundle. The writers run only in the service worker, through
 * one serial queue, so a stale read-modify-write can never resurrect a
 * revoked origin.
 */

export interface SitePermission {
  origin: string
  title?: string
  favicon?: string
  connectedAt: number
  lastUsedAt: number
  /** Accounts whose encrypted messages and inscriptions this origin may decrypt. */
  messageAccounts?: string[]
}

type PermissionsMap = Record<string, SitePermission>

async function readAll(): Promise<PermissionsMap> {
  if (!__IS_EXTENSION__) return {}
  const stored = await chrome.storage.local.get(STORAGE_KEY_SITE_PERMISSIONS)
  const value = stored[STORAGE_KEY_SITE_PERMISSIONS] as PermissionsMap | undefined
  return value && typeof value === 'object' ? value : {}
}

async function writeAll(map: PermissionsMap): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY_SITE_PERMISSIONS]: map })
}

const exclusive = createSerialQueue()

export function grant(
  origin: string,
  meta: { title?: string; favicon?: string } = {}
): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(async () => {
    const map = await readAll()
    const now = Date.now()
    const existing = map[origin]
    map[origin] = {
      origin,
      title: meta.title ?? existing?.title,
      favicon: meta.favicon ?? existing?.favicon,
      connectedAt: existing?.connectedAt ?? now,
      lastUsedAt: now,
      ...(existing?.messageAccounts && { messageAccounts: existing.messageAccounts }),
    }
    await writeAll(map)
  })
}

export function revoke(origin: string): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(async () => {
    const map = await readAll()
    delete map[origin]
    await writeAll(map)
  })
}

/** Lets a connected origin decrypt the account's messages. A no-op when the origin has no entry. */
export function grantMessages(origin: string, account: string): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(async () => {
    const map = await readAll()
    const existing = map[origin]
    if (!existing) return
    const accounts = existing.messageAccounts ?? []
    if (accounts.includes(account)) return
    map[origin] = { ...existing, messageAccounts: [...accounts, account] }
    await writeAll(map)
  })
}

/** Removes the origin's message access only. The site stays connected. */
export function revokeMessages(origin: string): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(async () => {
    const map = await readAll()
    const existing = map[origin]
    if (!existing?.messageAccounts) return
    const rest = { ...existing }
    delete rest.messageAccounts
    map[origin] = rest
    await writeAll(map)
  })
}

export function revokeAll(): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(() => writeAll({}))
}

/**
 * Records use of a grant. Throttled to one write per
 * SITE_PERMISSION_TOUCH_INTERVAL_MS per origin, because every
 * chrome.storage.local write fires onChanged in every extension context.
 */
export function touch(origin: string): Promise<void> {
  if (!__IS_EXTENSION__) return Promise.resolve()
  return exclusive(async () => {
    const map = await readAll()
    const existing = map[origin]
    if (!existing) return
    const now = Date.now()
    if (now - existing.lastUsedAt < SITE_PERMISSION_TOUCH_INTERVAL_MS) return
    map[origin] = { ...existing, lastUsedAt: now }
    await writeAll(map)
  })
}

export async function isGranted(origin: string): Promise<boolean> {
  if (!__IS_EXTENSION__) return false
  const map = await readAll()
  return origin in map
}

/**
 * Whether an origin may hold or use message access: `https:`, or a loopback
 * host (`localhost`, `127.0.0.1`, `[::1]`, `*.localhost`) on http or https.
 * A plain-http origin can be rewritten by anyone on the network path, and the
 * opaque origin `null` is shared by every sandboxed frame.
 */
export function isSecureMessageOrigin(origin: string): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  )
}

export async function canReadMessages(origin: string, account: string): Promise<boolean> {
  if (!__IS_EXTENSION__) return false
  const map = await readAll()
  return map[origin]?.messageAccounts?.includes(account) === true
}

export async function list(): Promise<SitePermission[]> {
  if (!__IS_EXTENSION__) return []
  const map = await readAll()
  return Object.values(map)
}

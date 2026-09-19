import { STORAGE_KEY_SITE_PERMISSIONS } from '@/config'

/**
 * Origin grants for the injected provider (§6.7). A grant covers the
 * read-only methods only — signing and sending prompt every time and are
 * never remembered. No expiry. Every function is a no-op (or returns an
 * empty result) when `!__IS_EXTENSION__`, so the module is inert if it ever
 * reaches the web bundle.
 */

export interface SitePermission {
  origin: string
  title?: string
  favicon?: string
  connectedAt: number
  lastUsedAt: number
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

export async function grant(
  origin: string,
  meta: { title?: string; favicon?: string } = {}
): Promise<void> {
  if (!__IS_EXTENSION__) return
  const map = await readAll()
  const now = Date.now()
  const existing = map[origin]
  map[origin] = {
    origin,
    title: meta.title ?? existing?.title,
    favicon: meta.favicon ?? existing?.favicon,
    connectedAt: existing?.connectedAt ?? now,
    lastUsedAt: now,
  }
  await writeAll(map)
}

export async function revoke(origin: string): Promise<void> {
  if (!__IS_EXTENSION__) return
  const map = await readAll()
  delete map[origin]
  await writeAll(map)
}

export async function revokeAll(): Promise<void> {
  if (!__IS_EXTENSION__) return
  await writeAll({})
}

export async function touch(origin: string): Promise<void> {
  if (!__IS_EXTENSION__) return
  const map = await readAll()
  if (!map[origin]) return
  map[origin] = { ...map[origin], lastUsedAt: Date.now() }
  await writeAll(map)
}

export async function isGranted(origin: string): Promise<boolean> {
  if (!__IS_EXTENSION__) return false
  const map = await readAll()
  return origin in map
}

export async function list(): Promise<SitePermission[]> {
  if (!__IS_EXTENSION__) return []
  const map = await readAll()
  return Object.values(map)
}

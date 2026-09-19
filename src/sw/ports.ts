import type { PortEventMessage } from '@/core/inpage-protocol'

/**
 * Port registry keyed `${tabId}:${frameId}` (§6.4, §6.8). Each granted-origin
 * frame holds one open port; events fan out to every port of a granted
 * origin. Phase 3b adds single-port outcome delivery and `resyncResult` on
 * top of this same registry.
 */

type PortKey = `${number}:${number}`

interface RegisteredPort {
  port: chrome.runtime.Port
  origin: string
  tabId: number
  frameId: number
}

const ports = new Map<PortKey, RegisteredPort>()

function keyFor(tabId: number, frameId: number): PortKey {
  return `${tabId}:${frameId}`
}

/** Registers a connected provider port, keyed by its sender's tab/frame. */
export function registerPort(port: chrome.runtime.Port): void {
  const sender = port.sender
  const tabId = sender?.tab?.id
  const frameId = sender?.frameId
  const origin = sender?.origin

  if (tabId === undefined || frameId === undefined || !origin) {
    port.disconnect()
    return
  }

  const key = keyFor(tabId, frameId)
  ports.set(key, { port, origin, tabId, frameId })

  port.onDisconnect.addListener(() => {
    // Only delete if this is still the port registered for the key — a
    // reconnect may already have replaced it by the time onDisconnect fires.
    if (ports.get(key)?.port === port) ports.delete(key)
  })
}

/** The port for one frame, if it has one open. Used for single-port delivery (phase 3b). */
export function getPort(tabId: number, frameId: number): chrome.runtime.Port | undefined {
  return ports.get(keyFor(tabId, frameId))?.port
}

/** Fans an event out to every open port belonging to the given origin (§6.8). */
export function broadcastEvent(origin: string, message: PortEventMessage): void {
  for (const entry of ports.values()) {
    if (entry.origin !== origin) continue
    try {
      entry.port.postMessage(message)
    } catch {
      // The port died before its onDisconnect listener fired; ignore.
    }
  }
}

/**
 * Disconnects every open port for one origin — used when a connected-sites
 * revoke happens outside the dApp's own tab (the settings dialog), so the
 * content script actually drops its port instead of only learning about the
 * revoke on its next unrelated read-only round trip.
 */
export function disconnectPortsForOrigin(origin: string): void {
  for (const [key, entry] of ports) {
    if (entry.origin !== origin) continue
    entry.port.disconnect()
    ports.delete(key)
  }
}

/** Disconnects every open port — used by connected-sites "revoke all". */
export function disconnectAllPorts(): void {
  for (const [key, entry] of ports) {
    entry.port.disconnect()
    ports.delete(key)
  }
}

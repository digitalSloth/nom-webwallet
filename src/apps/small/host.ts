import { inject, type Component, type InjectionKey, type Ref } from 'vue'

/** The Settings row that opens the host's connected sites or apps page. */
export interface SmallConnections {
  label: string
  /** A live detail line, e.g. "2 sites · 1 WalletConnect session". */
  detail: Readonly<Ref<string>>
}

/** What the page running the small app supplies to it. */
export interface SmallHost {
  kind: 'extension' | 'web'
  /** Where the wallet is open, for copy such as "Keep this popup open". */
  placeLabel: 'popup' | 'tab' | 'side panel' | 'window' | 'page'
  appVersion: string
  /** Extra Settings rows only one host has, e.g. the side panel switch. */
  settingsExtras?: Component
  /** Builds the Settings connections row. Call it in a page's setup: it may load data on mount. */
  useConnections(): SmallConnections
  /** Shows the host's unlock UI. After the unlock the wallet opens `path`, by default the current page. */
  requestUnlock(path?: string): void
}

export const SMALL_HOST_KEY: InjectionKey<SmallHost> = Symbol('SmallHost')

export function injectSmallHost(): SmallHost {
  const host = inject(SMALL_HOST_KEY, null)
  if (!host) throw new Error('The small app host was not provided by a root component.')
  return host
}

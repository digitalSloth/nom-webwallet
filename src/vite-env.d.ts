/// <reference types="vite/client" />

// Build-time constant injected by Vite `define`. True only in the extension build.
declare const __IS_EXTENSION__: boolean

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

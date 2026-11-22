/// <reference types="vite/client" />

// Build-time constant injected by Vite `define`. True only in the extension build.
declare const __IS_EXTENSION__: boolean

// Build-time constant injected by Vite define in the web build: the version in manifest.json.
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

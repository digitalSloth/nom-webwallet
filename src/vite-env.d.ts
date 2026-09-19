/// <reference types="vite/client" />

// Build-time constant injected by Vite `define`. True only in the extension build.
declare const __IS_EXTENSION__: boolean

interface ImportMetaEnv {
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// vite-plugin-node-polyfills ships no "types" export condition for its shim
// subpaths, though the shims themselves exist — see vite.shared.ts for why
// these are imported directly in page entries instead of injected plugin-wide.
declare module 'vite-plugin-node-polyfills/shims/global' {
  const globalShim: typeof globalThis
  export default globalShim
}

declare module 'vite-plugin-node-polyfills/shims/process' {
  const processShim: NodeJS.Process
  export default processShim
}

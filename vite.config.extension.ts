import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import {crx} from '@crxjs/vite-plugin'
import {nodePolyfills} from 'vite-plugin-node-polyfills'
import {resolve} from 'path'
import manifest from './manifest.json'
import {copyPowFiles, nodePolyfillsConfig} from './vite.shared'

export default defineConfig({
  define: {
    __IS_EXTENSION__: 'true',
  },
  plugins: [
    vue(),
    tailwindcss(),
    crx({manifest}),
    nodePolyfills(nodePolyfillsConfig),
    copyPowFiles(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    exclude: ['znn-typescript-sdk'],
  },
  build: {
    outDir: 'dist-extension',
    rollupOptions: {
      // §5.1 spike: a second HTML entry alongside crx()'s own input (the
      // popup's index.html), so the approval window gets its own chunk graph
      // and does not pull in App.vue, the router, or WalletConnect.
      input: {
        approve: resolve(__dirname, 'approve.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
})

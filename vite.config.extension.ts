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
      '@nom/ui/style.css': resolve(__dirname, './packages/ui/src/style.css'),
      '@nom/ui': resolve(__dirname, './packages/ui/src'),
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
  },
  worker: {
    format: 'es',
  },
})

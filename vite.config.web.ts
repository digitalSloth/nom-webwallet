import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'path'
import {nodePolyfills} from 'vite-plugin-node-polyfills'
import {copyPowFiles, nodePolyfillsConfig} from './vite.shared'

export default defineConfig({
  define: {
    __IS_EXTENSION__: 'false',
  },
  plugins: [vue(), tailwindcss(), copyPowFiles(), nodePolyfills(nodePolyfillsConfig)],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@nom/ui': resolve(__dirname, './packages/ui/src'),
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
  worker: {
    format: 'es',
  },
})

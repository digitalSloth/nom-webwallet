import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: {
      '@nom/ui/style.css': resolve(__dirname, './packages/ui/src/style.css'),
      '@nom/ui': resolve(__dirname, './packages/ui/src'),
      '@': resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist-extension',
  },
})

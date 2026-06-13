import {defineConfig, type Plugin} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import {resolve} from 'path'
import {copyFileSync, createReadStream} from 'fs'
import {nodePolyfills} from 'vite-plugin-node-polyfills'

const POW_FILES = ['pow.js', 'pow.wasm'] as const
const powSrcDir = resolve(__dirname, 'node_modules/znn-typescript-sdk/dist/browser')

// znn-typescript-sdk fetches pow.js + pow.wasm from the web root at runtime.
// Vite doesn't know about these files, so we must serve them during dev and
// copy them to dist/ during production builds.
function copyPowFiles(): Plugin {
  return {
    name: 'copy-pow-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.slice(1)
        if (name && (POW_FILES as readonly string[]).includes(name)) {
          res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'application/javascript')
          createReadStream(resolve(powSrcDir, name)).pipe(res)
          return
        }
        next()
      })
    },
    writeBundle(options) {
      const outDir = options.dir ?? resolve(__dirname, 'dist')
      for (const name of POW_FILES) {
        copyFileSync(resolve(powSrcDir, name), resolve(outDir, name))
      }
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    copyPowFiles(),
    nodePolyfills({
      include: ['crypto', 'buffer', 'stream', 'util'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'nom-ui': resolve(__dirname, './packages/ui/src'),
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

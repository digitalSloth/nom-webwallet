import {type Plugin} from 'vite'
import {nodePolyfills} from 'vite-plugin-node-polyfills'
import {resolve} from 'path'
import {copyFileSync, createReadStream} from 'fs'

const POW_FILES = ['pow.js', 'pow.wasm'] as const
const powSrcDir = resolve(__dirname, 'node_modules/znn-typescript-sdk/dist/browser')

// znn-typescript-sdk fetches pow.js + pow.wasm from the configured PoW base path
// at runtime. Vite doesn't know about these files, so we serve them during dev
// and copy them into the build output for production (both web and extension).
export function copyPowFiles(): Plugin {
  return {
    name: 'copy-pow-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.slice(1)
        if (name && (POW_FILES as readonly string[]).includes(name)) {
          res.setHeader(
            'Content-Type',
            name.endsWith('.wasm') ? 'application/wasm' : 'application/javascript'
          )
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

// Node polyfills required by znn-typescript-sdk. Identical for both build targets.
export const nodePolyfillsConfig: NonNullable<Parameters<typeof nodePolyfills>[0]> = {
  include: ['crypto', 'buffer', 'stream', 'util'],
  globals: {
    Buffer: true,
    global: true,
    process: true,
  },
}

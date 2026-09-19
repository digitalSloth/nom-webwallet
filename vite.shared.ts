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
//
// No plugin-level `globals`: that injects globalThis.Buffer/global/process into
// every entry chunk, including the MAIN-world content script that runs on every
// http(s) page the user visits — which would leak polyfill globals onto sites
// that feature-detect `process` and ship the bytes there. The page entries
// (main.ts, approve-main.ts) set the three globals explicitly instead; the
// content-script entries then receive nothing.
export const nodePolyfillsConfig: NonNullable<Parameters<typeof nodePolyfills>[0]> = {
  include: ['crypto', 'buffer', 'stream', 'util'],
}

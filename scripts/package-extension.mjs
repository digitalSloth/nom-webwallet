// Packages dist-extension/ into dist-extension.zip for Chrome Web Store upload.
// Uses the system `zip` binary to avoid adding an archiver dependency.
import {execFileSync} from 'node:child_process'
import {existsSync, rmSync} from 'node:fs'
import {resolve} from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist-extension')
const zipPath = resolve(root, 'dist-extension.zip')

if (!existsSync(dist)) {
  console.error('dist-extension/ not found. Run `npm run build:extension` first.')
  process.exit(1)
}

if (existsSync(zipPath)) rmSync(zipPath)
execFileSync('zip', ['-r', '-X', zipPath, '.'], {cwd: dist, stdio: 'inherit'})
// eslint-disable-next-line no-console -- build script intentionally reports its output path
console.log(`Created ${zipPath}`)

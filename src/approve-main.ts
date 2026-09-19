import { Buffer } from 'buffer'
import __global_polyfill from 'vite-plugin-node-polyfills/shims/global'
import __process_polyfill from 'vite-plugin-node-polyfills/shims/process'
import { createApp } from 'vue'
import { useToast } from 'nom-ui'
import ApproveApp from './ApproveApp.vue'
import './style.css'

// Same polyfill setup as main.ts — this is its own rollup entry (§5.1), so it
// needs its own copy; the SDK is used here too (parsing/sending blocks).
globalThis.Buffer = Buffer
globalThis.global = globalThis.global || __global_polyfill
globalThis.process = globalThis.process || __process_polyfill

const app = createApp(ApproveApp)

const { show } = useToast()
app.config.errorHandler = (err, _instance, info) => {
  console.error('Unhandled Vue error:', err, info)
  show('Something went wrong. Please try again.', 'error')
}

app.mount('#app')

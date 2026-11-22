import { Buffer } from 'buffer'
import { createApp } from 'vue'
import { useToast } from 'nom-ui'
import ApproveApp from './ApproveApp.vue'
import './style.css'

// Same Buffer setup as main.ts — this is its own rollup entry (§5.1), so it
// needs its own copy; the SDK is used here too (parsing/sending blocks).
globalThis.Buffer = Buffer

const app = createApp(ApproveApp)

const { show } = useToast()
app.config.errorHandler = (err, _instance, info) => {
  console.error('Unhandled Vue error:', err, info)
  show('Something went wrong. Please try again.', 'error')
}

app.mount('#app')

import {Buffer} from 'buffer'
import {createApp} from 'vue'
import {useToast} from '@nom/ui'
import App from './App.vue'
import {router} from './router'
import './style.css'

// Make Buffer available globally for SDK
globalThis.Buffer = Buffer

// An extension popup sizes itself to its content unless the document has an
// explicit width, which collapses narrow pages (e.g. /setup) into a tall sliver.
// Mark the document so the popup-sizing CSS applies; no-op in the web app.
if (__IS_EXTENSION__) {
  document.documentElement.classList.add('is-extension')
}

const app = createApp(App)

// Global error handler — surface otherwise-silent errors from render,
// lifecycle hooks, and watchers to the user (and the console).
const { show } = useToast()
app.config.errorHandler = (err, _instance, info) => {
  console.error('Unhandled Vue error:', err, info)
  show('Something went wrong. Please try again.', 'error')
}

app.use(router)
app.mount('#app')

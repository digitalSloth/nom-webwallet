import {Buffer} from 'buffer'
import {createApp} from 'vue'
import {useToast} from '@nom/ui'
import App from './App.vue'
import {router} from './router'
import './style.css'

// Make Buffer available globally for SDK
globalThis.Buffer = Buffer

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

import { Buffer } from 'buffer'
import { createApp, type Component } from 'vue'
import type { Router } from 'vue-router'
import { useToast } from 'nom-ui'
import '@/style.css'

// Make Buffer available globally for SDK
globalThis.Buffer = Buffer

/**
 * Creates and mounts a wallet app. Both the web app and the extension popup
 * start here, each with its own root layout and router.
 */
export function bootstrapApp(root: Component, router: Router): void {
  const app = createApp(root)

  // Global error handler — surface otherwise-silent errors from render,
  // lifecycle hooks, and watchers to the user (and the console).
  const { show } = useToast()
  app.config.errorHandler = (err, _instance, info) => {
    console.error('Unhandled Vue error:', err, info)
    show('Something went wrong. Please try again.', 'error')
  }

  app.use(router)

  // Wait for the initial navigation to resolve before mounting, so the shell's
  // onMounted sees the URL's query params (e.g. deep-linked node/chainId) via
  // route.query instead of racing router's async initial resolution.
  router.isReady().then(() => {
    app.mount('#app')
  })
}

import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    // Route needs at least one wallet to exist (else → welcome)
    requiresWallet?: boolean
    // Extension: route needs the active wallet unlocked (else → Locked screen)
    requiresUnlock?: boolean
    // Route renders without the app frame (popup frame or web sidebar) and the lock gate
    layout?: 'bare'
    // Small app: the route shows the tab bar
    tabBar?: boolean
  }
}

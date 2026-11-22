<script setup lang="ts">
import { surface } from '../surface'

// The side panel fills the panel. The tab, approval and WalletConnect
// windows centre the popup-sized frame, capped at the viewport height.
</script>

<template>
  <div
    v-if="surface === 'popup'"
    class="relative flex h-[600px] w-[360px] flex-col overflow-hidden bg-background"
  >
    <slot />
  </div>
  <div
    v-else-if="surface === 'sidepanel'"
    class="relative flex h-screen w-full flex-col overflow-hidden bg-background"
  >
    <slot />
  </div>
  <div v-else class="flex min-h-screen items-center justify-center bg-muted">
    <div
      class="relative flex h-[600px] max-h-screen w-[360px] flex-col overflow-hidden rounded-xl border bg-background shadow-lg"
    >
      <slot />
    </div>
  </div>
</template>

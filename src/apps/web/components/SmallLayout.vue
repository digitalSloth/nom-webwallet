<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useWallet } from '@/core'
import PowOverlay from '@/apps/small/components/PowOverlay.vue'
import TabBar from '@/apps/small/components/TabBar.vue'

const route = useRoute()
const wallet = useWallet()
</script>

<template>
  <div
    class="relative flex h-dvh flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
    :class="{ 'pb-[env(safe-area-inset-bottom)]': !route.meta.tabBar }"
  >
    <div class="relative flex min-h-0 flex-1 flex-col">
      <router-view name="small" :key="wallet.activeAccountAddress.value || route.fullPath" />
    </div>
    <TabBar v-if="route.meta.tabBar" />
    <PowOverlay />
  </div>
</template>

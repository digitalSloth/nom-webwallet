<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useWallet } from '@/core'
import TxToast from '@/shared/components/TxToast.vue'
import InterruptedDialog from './InterruptedDialog.vue'
import PowDialog from './PowDialog.vue'
import Sidebar from './Sidebar.vue'

const wallet = useWallet()
const route = useRoute()
</script>

<template>
  <div class="flex min-h-screen pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
    <Sidebar
      class="sticky top-0 h-screen w-[248px] shrink-0 pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
    />
    <main class="min-w-0 flex-1">
      <div class="container mx-auto px-8 pt-7 pb-12">
        <!-- Send stays mounted across an account switch so it can refuse a send reviewed for another account. -->
        <router-view
          name="large"
          :key="
            route.name === 'send'
              ? route.fullPath
              : wallet.activeAccountAddress.value || route.fullPath
          "
        />
      </div>
    </main>
    <div
      v-if="route.name !== 'tx'"
      class="fixed right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 w-[384px]"
    >
      <TxToast />
    </div>
    <PowDialog />
    <InterruptedDialog v-if="route.name === 'interrupted'" />
  </div>
</template>

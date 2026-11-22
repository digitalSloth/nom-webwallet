<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Toaster, TooltipProvider } from 'nom-ui'
import HomeSkeleton from '@/apps/small/components/HomeSkeleton.vue'
import AppSkeleton from './components/AppSkeleton.vue'
import DappRequestDialog from './components/DappRequestDialog.vue'
import LockedOverlay from './components/LockedOverlay.vue'
import NetworkLinkDialog from './components/NetworkLinkDialog.vue'
import SmallLayout from './components/SmallLayout.vue'
import WebLayout from './components/WebLayout.vue'
import { useLayout } from './layout-hold'
import { useToasterOffsets } from '@/shared/lib/useToasterOffsets'
import { usePhoneLayout } from './breakpoint'
import { useWebSession } from './useWebSession'
import { useWebShell } from './useWebShell'

const route = useRoute()
const { wallet } = useWebShell()
const { locked } = useWebSession()
const bare = computed(() => route.meta.layout === 'bare')
const phone = usePhoneLayout()
const layout = useLayout(route, phone)
const toaster = useToasterOffsets(() => layout.value === 'small')
</script>

<template>
  <TooltipProvider disable-hoverable-content>
    <!-- Toasts can name amounts, so none render over the locked view. -->
    <Toaster
      v-if="bare || !locked"
      class="pointer-events-auto"
      :offset="toaster.offset"
      :mobile-offset="toaster.mobileOffset"
    />
    <template v-if="locked && !bare">
      <div
        v-if="layout === 'small'"
        class="pointer-events-none fixed inset-0 bg-background opacity-40 blur-[16px] select-none"
        aria-hidden="true"
        inert
      >
        <HomeSkeleton />
      </div>
      <AppSkeleton v-else />
      <LockedOverlay :key="wallet.activeWallet.value?.baseAddress ?? 'none'" />
    </template>
    <SmallLayout v-else-if="layout === 'small'" />
    <router-view v-else-if="bare" name="large" />
    <WebLayout v-else />
    <DappRequestDialog :locked="locked" />
    <NetworkLinkDialog />
  </TooltipProvider>
</template>

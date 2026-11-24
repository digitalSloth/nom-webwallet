<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Toaster, TooltipProvider } from 'nom-ui'
import { useDappApprovals } from '@/core'
import ApprovalHost from './approval/ApprovalHost.vue'
import { dismissOpenLayers } from './approval/dismiss-layers'
import { createIdleWatch } from './approval/idle-watch'
import { rejectAllPending, startPanelApprovals } from './approval/panel-approvals'
import PopupFrame from './components/PopupFrame.vue'
import TabBar from '@/apps/small/components/TabBar.vue'
import PowOverlay from '@/apps/small/components/PowOverlay.vue'
import { useToasterOffsets } from '@/shared/lib/useToasterOffsets'
import { surface } from './surface'
import { useExtensionShell } from './useExtensionShell'

const route = useRoute()
const { wallet } = useExtensionShell()
const { currentApproval, isBusy, reject } = useDappApprovals()
const toaster = useToasterOffsets(
  () => true,
  () => surface === 'tab' || surface === 'window'
)

// The hash of an approved send whose result screen is showing.
const panelResult = ref<string | null>(null)
const panelShown = computed(() => currentApproval.value !== null || panelResult.value !== null)
// The idle reject and the layer dismissal belong to the side panel only.
const panelActive = computed(() => surface === 'sidepanel' && panelShown.value)

// Rejects the pending requests after the same idle time that closes the
// approval window, so a request left on screen cannot be approved hours later.
const idleWatch = createIdleWatch({
  isBusy: () => isBusy.value,
  onIdle: () =>
    void rejectAllPending({ currentId: () => currentApproval.value?.id, reject }).catch(
      (err: unknown) => console.error('Could not reject idle panel requests.', err)
    ),
})

watch(panelActive, (active) => {
  if (!active) return idleWatch.stop()
  // Popovers and selects from the page render outside the inert wrapper.
  void dismissOpenLayers()
  idleWatch.start()
})

onMounted(() => void startPanelApprovals())
onBeforeUnmount(() => idleWatch.stop())
</script>

<template>
  <TooltipProvider disable-hoverable-content>
    <Toaster
      class="pointer-events-auto"
      :offset="toaster.offset"
      :mobile-offset="toaster.mobileOffset"
    />
    <router-view v-if="route.meta.layout === 'bare'" />
    <template v-else>
      <PopupFrame>
        <div class="contents" :inert="panelShown || undefined">
          <div class="relative flex min-h-0 flex-1 flex-col">
            <router-view :key="wallet.activeAccountAddress.value || route.fullPath" />
          </div>
          <TabBar v-if="route.meta.tabBar" />
        </div>
        <div
          v-if="surface === 'sidepanel'"
          v-show="panelShown"
          class="absolute inset-0 z-40 flex flex-col bg-background"
        >
          <ApprovalHost v-model:result="panelResult" close-label="Done" />
        </div>
        <PowOverlay />
      </PopupFrame>
    </template>
  </TooltipProvider>
</template>

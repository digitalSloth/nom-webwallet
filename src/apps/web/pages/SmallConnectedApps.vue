<script setup lang="ts">
import { useRouter } from 'vue-router'
import PageHeader from '@/apps/small/components/PageHeader.vue'
import ConnectedApps from './ConnectedApps.vue'

const router = useRouter()
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Connected apps" @back="router.push({ name: 'settings' })" />
    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <ConnectedApps embedded />
    </div>
  </div>
</template>

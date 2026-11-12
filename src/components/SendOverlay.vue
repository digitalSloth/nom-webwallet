<script setup lang="ts">
import { Spinner } from 'nom-ui'
import { isGeneratingPow, isSendBusy, sendStep } from '@/core'
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isSendBusy"
      class="pointer-events-auto fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-busy="true"
    >
      <Spinner class="size-8" />
      <p class="text-lg font-medium">{{ sendStep }}</p>
      <p v-if="isGeneratingPow" class="text-sm text-muted-foreground">
        Generating plasma. This can take a minute.
      </p>
      <p class="text-sm text-muted-foreground">Keep this window open until the transaction is sent.</p>
    </div>
  </Teleport>
</template>

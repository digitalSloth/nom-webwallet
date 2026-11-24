<script setup lang="ts">
import { ZnnLogo } from 'nom-ui'

defineProps<{ label?: 'Create wallet' | 'Import wallet'; step?: number; steps?: number }>()
</script>

<template>
  <div
    class="flex min-h-full flex-col items-center gap-7 bg-background px-4 py-14 text-foreground"
    style="
      background-image: radial-gradient(
        circle at 50% 18%,
        hsl(145 100% 42% / 0.12),
        transparent 45%
      );
    "
  >
    <div class="flex items-center gap-2.5">
      <ZnnLogo class="size-8" />
      <span class="text-lg font-bold">NoM Wallet</span>
    </div>

    <div
      v-if="step !== undefined"
      class="flex w-full max-w-[560px] flex-col gap-5 rounded-xl border bg-card p-4 shadow desktop:p-7"
    >
      <div class="flex flex-col gap-2.5">
        <span class="text-ledger text-muted-foreground">
          {{ label }} · Step {{ step }} of {{ steps }}
        </span>
        <div
          role="progressbar"
          aria-label="Setup progress"
          :aria-valuenow="step"
          aria-valuemin="1"
          :aria-valuemax="steps"
          class="flex gap-1"
        >
          <span
            v-for="i in steps"
            :key="i"
            class="h-1 flex-1 rounded-full"
            :class="i <= step ? 'bg-plasma' : 'bg-muted'"
          />
        </div>
      </div>
      <slot />
    </div>
    <slot v-else />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex items-center justify-between gap-2 border-b px-4 py-3.5">
      <h1 class="truncate text-base font-semibold">{{ title }}</h1>
      <slot name="aside" />
    </header>

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="flex flex-col gap-2 border-t px-4 py-3">
      <slot name="footer" />
    </footer>
  </div>
</template>

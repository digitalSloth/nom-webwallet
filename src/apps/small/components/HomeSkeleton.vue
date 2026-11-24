<script setup lang="ts">
import { Skeleton } from 'nom-ui'
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 px-3 py-2.5">
      <Skeleton class="size-8 rounded-full" />
      <div class="flex flex-1 flex-col gap-1.5">
        <Skeleton class="h-3 w-24" />
        <Skeleton class="h-2.5 w-16" />
      </div>
      <Skeleton class="size-8 rounded-md" />
      <Skeleton class="size-8 rounded-md" />
    </div>
    <Skeleton class="mx-4 my-2 h-3 w-40" />
    <div class="grid grid-cols-2 gap-3 px-4">
      <Skeleton class="h-16 rounded-lg" />
      <Skeleton class="h-16 rounded-lg" />
    </div>
    <div class="grid grid-cols-2 gap-3 px-4 py-3">
      <Skeleton class="h-9 rounded-md" />
      <Skeleton class="h-9 rounded-md" />
    </div>
    <div class="flex gap-6 border-b px-4 py-2 text-sm text-muted-foreground">
      <span>Tokens</span>
      <span>Activity</span>
    </div>
    <div class="space-y-3 p-4">
      <Skeleton v-for="n in 4" :key="n" class="h-10 w-full" />
    </div>
  </div>
</template>

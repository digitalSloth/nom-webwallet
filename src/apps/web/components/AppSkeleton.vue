<template>
  <div
    class="pointer-events-none fixed inset-0 flex bg-background opacity-40 blur-[16px] select-none"
    aria-hidden="true"
    inert
  >
    <div
      class="flex w-[248px] shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-4"
    >
      <div class="h-6 w-32 rounded-md bg-muted" />
      <div class="h-14 rounded-lg bg-muted" />
      <div v-for="n in 6" :key="n" class="h-10 rounded-md bg-muted" />
    </div>
    <div class="flex-1 space-y-6 p-6">
      <div class="h-8 w-56 rounded-md bg-muted" />
      <div class="grid grid-cols-2 gap-4">
        <div class="h-32 rounded-xl bg-muted" />
        <div class="h-32 rounded-xl bg-muted" />
      </div>
      <div class="h-72 rounded-xl bg-muted" />
    </div>
  </div>
</template>

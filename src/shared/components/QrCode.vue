<script setup lang="ts">
import { computed } from 'vue'
import { encode } from 'uqr'

const props = defineProps<{ value: string }>()

const matrix = computed(() => encode(props.value, { border: 0 }))

const darkModules = computed(() => {
  const modules: { x: number; y: number }[] = []
  matrix.value.data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) modules.push({ x, y })
    })
  })
  return modules
})
</script>

<template>
  <div class="size-28 rounded-md bg-white p-1.5">
    <svg
      role="img"
      aria-label="QR code for your address"
      :viewBox="`0 0 ${matrix.size} ${matrix.size}`"
      shape-rendering="crispEdges"
      class="size-full"
    >
      <rect
        v-for="m in darkModules"
        :key="`${m.x}-${m.y}`"
        :x="m.x"
        :y="m.y"
        width="1"
        height="1"
        fill="#000"
      />
    </svg>
  </div>
</template>

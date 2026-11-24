<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Checkbox, CopyButton } from 'nom-ui'
import { EyeIcon } from 'lucide-vue-next'
import SetupHeader from '../components/SetupHeader.vue'
import { ensureCreateMnemonic, getSetupDraft } from '@/shared/lib/create-draft'

const router = useRouter()

// A remount after the draft was cleared renders nothing and never asks for a
// phrase.
const ready = getSetupDraft()?.kind === 'create'
const words = ready ? ensureCreateMnemonic().split(' ') : []

const revealed = ref(false)
const written = ref(false)
const cellNumbers = computed(() => words.map((_, i) => String(i + 1).padStart(2, '0')))

function onVisibility(): void {
  if (document.visibilityState === 'hidden') revealed.value = false
}

onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  revealed.value = false
})
</script>

<template>
  <div v-if="ready" class="flex h-full flex-col">
    <SetupHeader
      label="Create wallet · Step 2 of 3"
      :step="2"
      :steps="3"
      @back="router.push({ name: 'create-password' })"
    />

    <div class="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5">
      <div class="space-y-1">
        <h1 class="text-xl font-semibold">Your recovery phrase</h1>
        <p class="text-sm text-muted-foreground">
          Write these 24 words down in order. Anyone with them controls your funds.
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-ledger">24 words</span>
          <span class="flex items-center gap-1">
            <CopyButton v-if="revealed" :value="words.join(' ')" variant="ghost" size="xs" />
            <Button v-else variant="ghost" size="xs" disabled>Copy</Button>
            <Button variant="ghost" size="xs" @click="revealed = !revealed">
              {{ revealed ? 'Hide' : 'Reveal' }}
            </Button>
          </span>
        </div>

        <div class="relative">
          <ol aria-label="Recovery phrase" class="grid grid-cols-3 gap-1.5">
            <li
              v-for="(number, i) in cellNumbers"
              :key="i"
              class="flex gap-1.5 rounded-md border bg-card px-2 py-1.5 font-mono text-xs"
              :class="{ 'blur-sm select-none': !revealed }"
            >
              <span class="text-muted-foreground tabular-nums">{{ number }}</span>
              <span>{{ revealed ? words[i] : '••••••' }}</span>
            </li>
          </ol>
          <div
            v-if="!revealed"
            class="absolute inset-0 flex flex-col items-center justify-center gap-2"
          >
            <Button variant="outline" @click="revealed = true">
              <EyeIcon />
              Reveal phrase
            </Button>
            <span class="text-xs text-muted-foreground">Make sure no one can see your screen</span>
          </div>
        </div>
      </div>

      <label class="flex items-start gap-2 text-sm">
        <Checkbox
          :model-value="written"
          class="mt-0.5"
          @update:model-value="written = $event === true"
        />
        <span>I've written down all 24 words in order and stored them offline.</span>
      </label>

      <div class="flex-1" />
      <Button
        size="lg"
        class="w-full"
        :disabled="!written"
        @click="router.push({ name: 'create-verify' })"
      >
        Continue
      </Button>
    </div>
  </div>
</template>

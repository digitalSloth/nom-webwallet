<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Checkbox, CopyButton } from 'nom-ui'
import { EyeIcon } from 'lucide-vue-next'
import { ensureCreateMnemonic, getSetupDraft } from '@/shared/lib/create-draft'
import OnboardingLayout from './OnboardingLayout.vue'

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
  <OnboardingLayout v-if="ready" label="Create wallet" :step="2" :steps="3">
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-2xl font-semibold">Your recovery phrase</h1>
        <p class="text-sm leading-relaxed text-muted-foreground">
          Write these 24 words down in order. Anyone with them controls your funds.
        </p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-ledger text-muted-foreground">24 words</span>
          <span class="flex items-center gap-1">
            <CopyButton v-if="revealed" :value="words.join(' ')" variant="ghost" size="xs" />
            <Button variant="ghost" size="xs" @click="revealed = !revealed">
              {{ revealed ? 'Hide' : 'Reveal' }}
            </Button>
          </span>
        </div>

        <div class="relative">
          <ol
            aria-label="Recovery phrase"
            class="grid grid-cols-3 gap-1 rounded-lg border p-2 desktop:grid-cols-4 desktop:gap-1.5 desktop:p-3"
          >
            <li
              v-for="(number, i) in cellNumbers"
              :key="i"
              class="flex h-8 items-center gap-1 rounded-md bg-muted px-1.5 font-mono text-xs desktop:gap-1.5 desktop:px-2 desktop:text-[13px]"
              :class="{ 'blur-sm select-none': !revealed }"
            >
              <span class="text-[10px] text-muted-foreground tabular-nums">{{ number }}</span>
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

      <label class="flex items-start gap-2.5 text-sm leading-snug">
        <Checkbox
          :model-value="written"
          class="mt-0.5"
          @update:model-value="written = $event === true"
        />
        <span>I've written down all 24 words in order and stored them offline.</span>
      </label>

      <div class="grid grid-cols-2 gap-2">
        <Button variant="outline" size="lg" @click="router.push({ name: 'create-password' })">
          Back
        </Button>
        <Button size="lg" :disabled="!written" @click="router.push({ name: 'create-verify' })">
          Continue
        </Button>
      </div>
    </div>
  </OnboardingLayout>
</template>

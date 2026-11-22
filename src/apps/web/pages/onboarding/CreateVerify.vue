<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from 'nom-ui'
import { useWallet } from '@/core'
import { clearSetupDraft, getSetupDraft } from '@/shared/lib/create-draft'
import { allChallengesPassed, cryptoRandom, pickChallenges } from '@/shared/lib/verify-phrase'
import OnboardingLayout from './OnboardingLayout.vue'

const router = useRouter()
const wallet = useWallet()

// Read once. A remount after the draft was cleared renders nothing.
const draft = getSetupDraft()
const createDraft = draft?.kind === 'create' && draft.mnemonic !== null ? draft : null
const words = createDraft?.mnemonic?.split(' ') ?? []
const challenges = createDraft ? pickChallenges(words, cryptoRandom) : []

// Picked word per 1-based position
const picks = ref<Record<number, string>>({})
const busy = ref(false)
const error = ref<string | null>(null)

function isRight(position: number, pick: string): boolean {
  return pick === words[position - 1]
}

const allRight = computed(() => allChallengesPassed(words, challenges, picks.value))

function pickClass(position: number, choice: string): string {
  const pick = picks.value[position]
  if (pick !== choice) return 'border-border bg-card'
  return isRight(position, choice) ? 'border-primary bg-accent' : 'border-destructive bg-card'
}

async function create(): Promise<void> {
  if (!createDraft || !allRight.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await wallet.importWallet(
      createDraft.mnemonic!,
      createDraft.password,
      createDraft.name || 'Main wallet'
    )
    clearSetupDraft()
    await router.replace({ name: 'home' })
  } catch (err) {
    error.value = `Could not create the wallet: ${err instanceof Error ? err.message : 'unknown error'}`
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <OnboardingLayout v-if="createDraft" label="Create wallet" :step="3" :steps="3">
    <div class="flex flex-col gap-5">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-2xl font-semibold">Confirm your phrase</h1>
        <p class="text-sm leading-relaxed text-muted-foreground">
          Pick the correct word for each position.
        </p>
      </div>

      <fieldset v-for="challenge in challenges" :key="challenge.position" class="flex flex-col">
        <legend class="pb-2 text-sm font-medium">
          Word <span class="font-mono tabular-nums">#{{ challenge.position }}</span>
        </legend>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="choice in challenge.choices"
            :key="choice"
            type="button"
            class="h-10 rounded-md border font-mono text-[13px]"
            :class="pickClass(challenge.position, choice)"
            :aria-pressed="picks[challenge.position] === choice"
            :disabled="busy"
            @click="picks[challenge.position] = choice"
          >
            {{ choice }}
          </button>
        </div>
        <p
          v-if="
            picks[challenge.position] !== undefined &&
            !isRight(challenge.position, picks[challenge.position])
          "
          role="alert"
          class="pt-2 text-xs text-destructive"
        >
          That's not word #{{ challenge.position }}. Check your written copy.
        </p>
      </fieldset>

      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>

      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          size="lg"
          :disabled="busy"
          @click="router.push({ name: 'create-phrase' })"
        >
          Back
        </Button>
        <Button size="lg" :disabled="!allRight || busy" @click="create">
          {{ busy ? 'Creating…' : 'Create wallet' }}
        </Button>
      </div>
    </div>
  </OnboardingLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Textarea } from 'nom-ui'
import { CheckIcon, ClipboardPasteIcon, ShieldCheckIcon } from 'lucide-vue-next'
import { getSetupDraft, startImportDraft } from '@/shared/lib/create-draft'
import { checkPhrase, phraseStatus } from '@/shared/lib/phrase'
import OnboardingLayout from './OnboardingLayout.vue'

const router = useRouter()

const draft = getSetupDraft()
const text = ref(draft?.kind === 'import' ? draft.phrase : '')
const pasteError = ref<string | null>(null)

const check = computed(() => checkPhrase(text.value))
const status = computed(() => phraseStatus(text.value))

async function paste(): Promise<void> {
  pasteError.value = null
  try {
    text.value = await navigator.clipboard.readText()
  } catch {
    pasteError.value = 'Paste with Ctrl+V or ⌘V'
  }
}

function next(): void {
  if (!check.value.valid) return
  startImportDraft(check.value.phrase)
  void router.push({ name: 'import-password' })
}
</script>

<template>
  <OnboardingLayout label="Import wallet" :step="1" :steps="2">
    <form class="flex flex-col gap-5" @submit.prevent="next">
      <div class="flex flex-col gap-1.5">
        <h1 class="text-2xl font-semibold">Import recovery phrase</h1>
        <p class="text-sm leading-relaxed text-muted-foreground">
          Enter your 12 or 24 words in order, separated by spaces.
        </p>
      </div>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <label for="import-phrase" class="text-ledger text-muted-foreground">
            Recovery phrase
          </label>
          <Button type="button" variant="ghost" size="xs" @click="paste">
            <ClipboardPasteIcon />
            Paste
          </Button>
        </div>
        <Textarea
          id="import-phrase"
          v-model="text"
          rows="4"
          class="font-mono"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
        />
        <p v-if="pasteError" role="alert" class="text-xs text-destructive">{{ pasteError }}</p>
        <p
          v-if="status"
          :role="status.kind === 'error' ? 'alert' : undefined"
          class="flex items-center gap-1 text-[13px]"
          :class="{
            'text-destructive': status.kind === 'error',
            'text-muted-foreground': status.kind === 'info',
            'text-success': status.kind === 'ok',
          }"
        >
          <CheckIcon v-if="status.kind === 'ok'" class="size-3.5" />
          {{ status.message }}
        </p>
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheckIcon class="size-3.5 shrink-0" />
        <span>NoM Wallet will never ask for your phrase outside this screen.</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="lg" @click="router.push({ name: 'welcome' })">
          Back
        </Button>
        <Button type="submit" size="lg" :disabled="!check.valid">Continue</Button>
      </div>
    </form>
  </OnboardingLayout>
</template>

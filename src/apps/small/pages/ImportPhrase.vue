<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button, Textarea } from 'nom-ui'
import { CheckIcon, ClipboardPasteIcon, ShieldCheckIcon } from 'lucide-vue-next'
import SetupHeader from '../components/SetupHeader.vue'
import { getSetupDraft, startImportDraft } from '@/shared/lib/create-draft'
import { checkPhrase, phraseStatus } from '@/shared/lib/phrase'

const router = useRouter()

const draft = getSetupDraft()
const text = ref(draft?.kind === 'import' ? draft.phrase : '')
const pasteError = ref<string | null>(null)

const check = computed(() => checkPhrase(text.value))

const status = computed(() => phraseStatus(text.value))

function back(): void {
  if (typeof window.history.state?.back === 'string') router.back()
  else void router.push({ name: 'welcome' })
}

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
  <div class="flex h-full flex-col">
    <SetupHeader label="Import wallet · Step 1 of 2" :step="1" :steps="2" @back="back" />

    <form class="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-5" @submit.prevent="next">
      <div class="space-y-1">
        <h1 class="text-xl font-semibold">Import recovery phrase</h1>
        <p class="text-sm text-muted-foreground">
          Enter your 12 or 24 words in order, separated by spaces.
        </p>
      </div>

      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <label for="import-phrase" class="text-ledger">Recovery phrase</label>
          <Button type="button" variant="ghost" size="xs" @click="paste">
            <ClipboardPasteIcon />
            Paste
          </Button>
        </div>
        <Textarea
          id="import-phrase"
          v-model="text"
          rows="7"
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
          class="flex items-center gap-1 text-xs"
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

      <div class="flex-1" />
      <Button type="submit" size="lg" class="w-full" :disabled="!check.valid">Continue</Button>
    </form>
  </div>
</template>

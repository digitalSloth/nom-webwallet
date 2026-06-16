<script setup lang="ts">
import {ref, toRef} from 'vue'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldLabel,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from 'nom-ui'
import {CheckIcon, CopyIcon, EyeIcon, TriangleAlertIcon} from 'lucide-vue-next'

interface Props {
  mnemonic: string
  address?: string | null
  walletName?: string
  initiallyVisible?: boolean
  showAddress?: boolean
  showCheckbox?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  address: null,
  walletName: undefined,
  initiallyVisible: false,
  showAddress: false,
  showCheckbox: false,
})

const emit = defineEmits<{
  confirmed: []
}>()

const initiallyVisibleRef = toRef(props, 'initiallyVisible')
const mnemonicVisible = ref(initiallyVisibleRef.value)
const mnemonicCopied = ref(false)
const mnemonicConfirmed = ref(false)

function copyMnemonic() {
  navigator.clipboard.writeText(props.mnemonic)
  mnemonicCopied.value = true
  setTimeout(() => (mnemonicCopied.value = false), 2000)
}

function handleConfirm() {
  if (mnemonicConfirmed.value) {
    emit('confirmed')
  }
}
</script>

<template>
  <div class="space-y-4">
    <!-- Security Warning -->
    <Alert variant="destructive">
      <TriangleAlertIcon />
      <AlertTitle>Important: Save Your Recovery Phrase</AlertTitle>
      <AlertDescription>
        Write down these {{ mnemonic.split(' ').length }} words in order and store them safely. This
        is the ONLY way to recover your wallet if you lose access.
      </AlertDescription>
    </Alert>

    <!-- Address Display (optional) -->
    <Item v-if="showAddress && address" variant="outline">
      <ItemContent>
        <ItemTitle>Your Address</ItemTitle>
        <ItemDescription>
          <div class="rounded-md bg-muted p-4 font-mono text-sm break-all">
            {{ address }}
          </div>
        </ItemDescription>
      </ItemContent>
    </Item>

    <!-- Mnemonic Display -->
    <!-- Mnemonic Display with Reveal/Hide -->
    <div class="relative">
      <!-- Blur Overlay -->
      <div
        v-if="!mnemonicVisible"
        class="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/95 backdrop-blur-sm"
      >
        <Button @click="mnemonicVisible = true">
          <EyeIcon class="mr-2 h-4 w-4" />
          Reveal Recovery Phrase
        </Button>
      </div>

      <!-- Mnemonic Grid -->
      <div
        class="rounded-md border bg-muted p-4 font-mono text-sm shadow"
        :aria-hidden="!mnemonicVisible"
      >
        <div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div
            v-for="(word, index) in mnemonic.split(' ')"
            :key="index"
            class="rounded bg-background p-2"
          >
            <span class="mr-1 text-muted-foreground">{{ index + 1 }}.</span>{{ word }}
          </div>
        </div>
        <!-- Copy Button -->
        <Button
          v-if="mnemonicVisible"
          variant="outline"
          size="sm"
          class="w-full"
          @click="copyMnemonic"
        >
          <CheckIcon v-if="mnemonicCopied" class="mr-2 h-4 w-4" />
          <CopyIcon v-else class="mr-2" />
          {{ mnemonicCopied ? 'Copied!' : 'Copy Recovery Phrase' }}
        </Button>
      </div>
    </div>

    <!-- Confirmation Checkbox -->
    <Field orientation="horizontal" v-if="showCheckbox">
      <Checkbox
        v-model="mnemonicConfirmed"
        id="mnemonic-confirm"
        @update:model-value="handleConfirm"
      />
      <FieldLabel for="mnemonic-confirm">
        I have saved my recovery phrase in a safe place
      </FieldLabel>
    </Field>
  </div>
</template>

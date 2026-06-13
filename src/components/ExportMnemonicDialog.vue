<script setup lang="ts">
import {Dialog, DialogContent, DialogHeader, DialogTitle} from 'nom-ui'
import MnemonicDisplay from './MnemonicDisplay.vue'

interface Props {
  mnemonic: string
  walletName: string
}

defineProps<Props>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Export Recovery Phrase</DialogTitle>
        <p class="text-sm text-muted-foreground">{{ walletName }}</p>
      </DialogHeader>
      <MnemonicDisplay
        :mnemonic="mnemonic"
        :wallet-name="walletName"
        :show-checkbox="true"
        @confirmed="emit('close')"
      />
    </DialogContent>
  </Dialog>
</template>

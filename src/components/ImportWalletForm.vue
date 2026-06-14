<script setup lang="ts">
import {computed, ref} from 'vue'
import {estimatePasswordStrength, usePasswordStrength, useWallet} from '@/core'
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Textarea,
  useToast
} from '@nom/ui'
import {EyeIcon, EyeOffIcon} from 'lucide-vue-next'
import PasswordStrengthMeter from './PasswordStrengthMeter.vue'

const emit = defineEmits<{
  success: [walletAddress: string]
  cancel: []
}>()

const wallet = useWallet()
const toast = useToast()

const name = ref('')
const mnemonic = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const isImporting = ref(false)

const mnemonicWords = computed(() => mnemonic.value.trim().split(/\s+/).filter(Boolean))
const mnemonicValid = computed(() => mnemonicWords.value.length === 12 || mnemonicWords.value.length === 24)
const passwordsMatch = computed(() => password.value === confirmPassword.value)
const strength = usePasswordStrength(password)
const passwordStrong = computed(() => strength.value.meetsFloor)
const canSubmit = computed(
  () => mnemonicValid.value && passwordStrong.value && passwordsMatch.value && !isImporting.value
)

async function handleImport() {
  if (!canSubmit.value) return

  // Guard re-entry before any await so a fast double-click can't start two
  // concurrent imports while the password is being (re-)scored.
  if (isImporting.value) return
  isImporting.value = true
  try {
    // Snapshot the inputs before any await. Fields stay editable during scoring,
    // so we must validate and import with the exact values submitted — never
    // re-read password.value later, or an edit mid-await could swap in a weaker
    // password than the one we scored.
    const pw = password.value
    const mnemonicValue = mnemonic.value.trim()
    const walletName = name.value || 'Imported Wallet'

    // Authoritative gate: re-score the snapshotted password.
    const finalStrength = await estimatePasswordStrength(pw)
    if (!finalStrength.meetsFloor) {
      toast.show('Please choose a stronger password', 'warning')
      return
    }

    const importedWallet = await wallet.importWallet(mnemonicValue, pw, walletName)
    emit('success', importedWallet.baseAddress)
  } catch (error) {
    console.error('Failed to import wallet:', error)
    toast.show('Failed to import wallet. Please check your recovery phrase and try again.', 'error')
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-2xl font-bold mb-2">Import Wallet</h2>
      <p class="text-sm text-muted-foreground mb-6">Enter your recovery phrase to restore your wallet</p>
    </div>

    <FieldGroup>
      <Field>
        <FieldLabel for="import-wallet-name">Wallet Name (optional)</FieldLabel>
        <Input id="import-wallet-name" v-model="name" placeholder="Imported Wallet" />
      </Field>

      <Field>
        <FieldLabel for="recovery-phrase">Recovery Phrase (12 or 24 words)</FieldLabel>
        <Textarea
          id="recovery-phrase"
          v-model="mnemonic"
          placeholder="word1 word2 word3 ..."
          class="min-h-[80px]"
        />
        <FieldDescription>
          {{ mnemonicWords.length }} words entered
          <span v-if="mnemonic && !mnemonicValid" class="text-destructive">
            (must be 12 or 24 words)
          </span>
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel for="import-password">Password</FieldLabel>
        <InputGroup>
          <InputGroupInput
            id="import-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Enter password"
            name="password"
            autocomplete="new-password"
            autocapitalize="off"
            spellcheck="false"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton variant="invisible" type="button" size="icon-xs" tabindex="-1" @click.stop="showPassword = !showPassword">
              <EyeIcon v-if="!showPassword" class="h-4 w-4 text-muted-foreground hover:text-foreground hover:bg-transparent" />
              <EyeOffIcon v-else class="h-4 w-4 text-muted-foreground hover:text-foreground hover:bg-transparent" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <PasswordStrengthMeter v-if="password" :strength="strength" class="mt-2" />
      </Field>

      <Field>
        <FieldLabel for="import-confirm-password">Confirm Password</FieldLabel>
        <Input
          id="import-confirm-password"
          v-model="confirmPassword"
          type="password"
          placeholder="Confirm password"
          name="password"
          autocomplete="new-password"
          autocapitalize="off"
          spellcheck="false"
        />
        <FieldDescription v-if="confirmPassword && !passwordsMatch" class="text-destructive">
          Passwords do not match
        </FieldDescription>
      </Field>

      <div class="flex gap-3">
        <Button variant="outline" class="flex-1" @click="emit('cancel')">Cancel</Button>
        <Button class="flex-1" :disabled="!canSubmit" @click="handleImport">
          {{ isImporting ? 'Importing...' : 'Import Wallet' }}
        </Button>
      </div>
    </FieldGroup>
  </div>
</template>

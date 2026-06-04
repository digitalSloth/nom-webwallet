<script setup lang="ts">
import {computed, ref} from 'vue'
import {estimatePasswordStrength, useWallet} from '@/core'
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
  useToast
} from '@nom/ui'
import {EyeIcon, EyeOffIcon} from 'lucide-vue-next'
import MnemonicDisplay from './MnemonicDisplay.vue'
import PasswordStrengthMeter from './PasswordStrengthMeter.vue'

const emit = defineEmits<{
  success: [walletAddress: string]
  cancel: []
}>()

const wallet = useWallet()
const toast = useToast()

const step = ref<'password' | 'mnemonic'>('password')
const name = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const mnemonic = ref<string | null>(null)
const address = ref<string | null>(null)
const isCreating = ref(false)

const passwordsMatch = computed(() => password.value === confirmPassword.value)
const strength = computed(() => estimatePasswordStrength(password.value))
const passwordStrong = computed(() => strength.value.meetsFloor)

async function handleCreate() {
  if (!passwordStrong.value) {
    toast.show('Please choose a stronger password', 'warning')
    return
  }
  if (!passwordsMatch.value) {
    toast.show('Passwords do not match', 'warning')
    return
  }

  isCreating.value = true
  try {
    const newWallet = await wallet.createWallet(password.value, name.value || 'Main Wallet')
    mnemonic.value = wallet.exportMnemonic(newWallet.baseAddress)
    address.value = newWallet.baseAddress
    step.value = 'mnemonic'
  } catch (error) {
    console.error('Failed to create wallet:', error)
    toast.show('Failed to create wallet. Please try again.', 'error')
  } finally {
    isCreating.value = false
  }
}

function handleComplete() {
  if (address.value) {
    emit('success', address.value)
  }
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="step === 'password'">
      <h2 class="text-2xl font-bold mb-2">Create New Wallet</h2>
      <p class="text-sm text-muted-foreground mb-6">
        Set a strong password to encrypt your wallet
      </p>

      <FieldGroup>
        <Field>
          <FieldLabel for="wallet-name">Wallet Name (optional)</FieldLabel>
          <Input id="wallet-name" v-model="name" placeholder="Main Wallet" />
        </Field>

        <Field>
          <FieldLabel for="wallet-password">Password</FieldLabel>
          <InputGroup>
            <InputGroupInput
                id="wallet-password"
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
          <FieldLabel for="confirm-password">Confirm Password</FieldLabel>
          <Input
            id="confirm-password"
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
          <Button class="flex-1" @click="handleCreate" :disabled="!passwordsMatch || !passwordStrong || isCreating">
            {{ isCreating ? 'Creating...' : 'Continue' }}
          </Button>
        </div>
      </FieldGroup>
    </div>

    <div v-if="step === 'mnemonic' && mnemonic">
      <h2 class="text-2xl font-bold mb-2">Save Your Recovery Phrase</h2>
      <p class="text-sm text-muted-foreground mb-6">
        Write down these words in order and keep them safe
      </p>

      <FieldGroup>
        <MnemonicDisplay
          :mnemonic="mnemonic"
          :address="address"
          :show-address="false"
          :initially-visible="true"
          @confirmed="handleComplete"
        />

        <Button class="w-full" @click="handleComplete">
          Continue
        </Button>
      </FieldGroup>
    </div>
  </div>
</template>

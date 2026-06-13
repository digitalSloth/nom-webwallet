<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from 'nom-ui'

import {EyeIcon, EyeOffIcon, LockOpenIcon} from 'lucide-vue-next'

interface Props {
  open: boolean
  walletAddress: string
  walletName?: string
  unlockError?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  unlock: [password: string]
  cancel: []
  'update:open': [value: boolean]
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    emit('update:open', value)
    if (!value) emit('cancel')
  }
})

const password = ref('')
const showPassword = ref(false)
const error = ref('')
const isUnlocking = ref(false)

// Watch for external unlock errors
watch(() => props.unlockError, (newError) => {
  if (newError) {
    error.value = newError
    isUnlocking.value = false
  }
})

// Clear error when password changes
watch(password, () => {
  if (error.value) {
    error.value = ''
  }
})

// Reset state when dialog opens/closes
watch(() => props.open, (newOpen) => {
  if (!newOpen) {
    // Reset all state when dialog closes
    password.value = ''
    showPassword.value = false
    error.value = ''
    isUnlocking.value = false
  }
})

function handleUnlock() {
  if (!password.value) {
    error.value = 'Password is required'
    return
  }
  error.value = ''
  isUnlocking.value = true
  emit('unlock', password.value)
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="p-2 bg-primary/10 rounded-full">
            <LockOpenIcon class="h-5 w-5 text-primary" />
          </div>
          <div>
            <DialogTitle>Unlock Wallet</DialogTitle>
            <p class="text-sm text-muted-foreground text-left">{{ walletName || 'Wallet' }}</p>
          </div>
        </div>
      </DialogHeader>
      <FieldGroup class="my-3">
        <FieldSet>
          <FieldDescription>
            <div class="p-3 bg-muted rounded-md text-sm font-mono break-all">
              {{ walletAddress }}
            </div>
          </FieldDescription>
          <FieldGroup>
            <Field>
              <FieldLabel for="unlock-dialog-password">
                Password
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                    v-model="password"
                    id="unlock-dialog-password"
                    :type="showPassword ? 'text' : 'password'"
                    name="password"
                    autocomplete="current-password"
                    autocapitalize="off"
                    spellcheck="false"
                    placeholder="Enter password"
                    class="password-input"
                    @keyup.enter="handleUnlock"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton variant="invisible" type="button" size="icon-xs" @click.stop="showPassword = !showPassword">
                    <EyeIcon v-if="!showPassword" class="h-4 w-4 text-muted-foreground hover:text-foreground hover:bg-transparent" />
                    <EyeOffIcon v-else class="h-4 w-4 text-muted-foreground hover:text-foreground hover:bg-transparent" />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
            </Field>
          </FieldGroup>
        </FieldSet>
      </FieldGroup>
      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" @click="isOpen = false">Cancel</Button>
        </DialogClose>
        <Button @click="handleUnlock" :disabled="isUnlocking">
          {{ isUnlocking ? 'Unlocking...' : 'Unlock' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import {ref, watch} from 'vue'
import type {Wallet} from '@/types'
import {truncateAddress} from '@/core'
import AccountList from './AccountList.vue'
import CreateWalletForm from './CreateWalletForm.vue'
import ImportWalletForm from './ImportWalletForm.vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from 'nom-ui'
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LockIcon,
  LockOpenIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-vue-next'

interface Props {
  wallets: Wallet[]
  unlockedWallets: string[]
  activeAccountAddress?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  unlock: [address: string]
  lock: [address: string]
  delete: [address: string]
  exportMnemonic: [address: string]
  rename: [address: string, newName: string]
  deriveAccount: [walletAddress: string]
  selectAccount: [address: string]
  renameAccount: [walletAddress: string, accountAddress: string, newLabel: string]
  toggleHidden: [walletAddress: string, accountAddress: string, hidden: boolean]
  walletAdded: [address: string]
}>()

const editingWalletAddress = ref<string | null>(null)
const editingWalletName = ref('')

// Per-session, per-wallet "show hidden accounts" toggle
const showHiddenByWallet = ref<Record<string, boolean>>({})

function hiddenAccountCount(wallet: Wallet): number {
  return wallet.accounts.filter((a) => a.hidden).length
}

function toggleShowHidden(walletAddress: string) {
  showHiddenByWallet.value[walletAddress] = !showHiddenByWallet.value[walletAddress]
}

// Add wallet dialog state
const addWalletDialogOpen = ref(false)
const addWalletMode = ref<'choice' | 'create' | 'import'>('choice')

// Track pending export action
const pendingExportAddress = ref<string | null>(null)

// Track pending derive account action
const pendingDeriveAddress = ref<string | null>(null)

function isUnlocked(address: string): boolean {
  return props.unlockedWallets.includes(address)
}

// Watch for wallet unlock to proceed with pending actions
watch(
  () => props.unlockedWallets,
  (newUnlockedWallets) => {
    // Handle pending export
    if (pendingExportAddress.value && newUnlockedWallets.includes(pendingExportAddress.value)) {
      emit('exportMnemonic', pendingExportAddress.value)
      pendingExportAddress.value = null
    }

    // Handle pending derive account
    if (pendingDeriveAddress.value && newUnlockedWallets.includes(pendingDeriveAddress.value)) {
      emit('deriveAccount', pendingDeriveAddress.value)
      pendingDeriveAddress.value = null
    }
  }
)

function handleExportMnemonic(address: string) {
  // If wallet is locked, unlock it first and track pending export
  if (!isUnlocked(address)) {
    pendingExportAddress.value = address
    emit('unlock', address)
    return
  }
  // If already unlocked, proceed with export
  emit('exportMnemonic', address)
}

function handleDeriveAccount(address: string) {
  // If wallet is locked, unlock it first and track pending derive
  if (!isUnlocked(address)) {
    pendingDeriveAddress.value = address
    emit('unlock', address)
    return
  }
  // If already unlocked, proceed with derive account
  emit('deriveAccount', address)
}

function startEdit(wallet: Wallet) {
  editingWalletAddress.value = wallet.baseAddress
  editingWalletName.value = wallet.name
}

function saveEdit(address: string) {
  if (editingWalletName.value.trim()) {
    emit('rename', address, editingWalletName.value.trim())
  }
  editingWalletAddress.value = null
  editingWalletName.value = ''
}

function cancelEdit() {
  editingWalletAddress.value = null
  editingWalletName.value = ''
}

function handleWalletCreated(address: string) {
  addWalletDialogOpen.value = false
  addWalletMode.value = 'choice'
  emit('walletAdded', address)
}

function handleWalletImported(address: string) {
  addWalletDialogOpen.value = false
  addWalletMode.value = 'choice'
  emit('walletAdded', address)
}

function handleAddWalletCancel() {
  if (addWalletMode.value === 'choice') {
    addWalletDialogOpen.value = false
  } else {
    addWalletMode.value = 'choice'
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="wallet in wallets" :key="wallet.baseAddress">
      <div class="pb-3">
        <div class="flex items-start justify-between gap-3">
          <!-- Left: Wallet Info -->
          <div class="min-w-0 flex-1">
            <!-- Wallet Name (Editable) -->
            <div
              v-if="editingWalletAddress === wallet.baseAddress"
              class="mb-2 flex items-center gap-2"
            >
              <InputGroup>
                <InputGroupInput
                  v-model="editingWalletName"
                  @keyup.enter="saveEdit(wallet.baseAddress)"
                  @keyup.esc="cancelEdit"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    aria-label="Save"
                    title="Save"
                    size="icon-xs"
                    @click="saveEdit(wallet.baseAddress)"
                  >
                    <CheckIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </div>
            <div v-else class="mb-2 flex items-center gap-2">
              <h3 class="truncate text-lg font-semibold">{{ wallet.name }}</h3>
              <Button size="sm" variant="ghost" @click="startEdit(wallet)" class="h-6 w-6 p-0">
                <PencilIcon class="h-3 w-3" />
              </Button>
            </div>

            <!-- Wallet Address -->
            <p class="font-mono text-sm text-muted-foreground">
              {{ truncateAddress(wallet.baseAddress) }}
            </p>
          </div>
        </div>
      </div>

      <div class="space-y-3 pt-0">
        <!-- Action Buttons -->
        <div class="flex items-center gap-2">
          <!-- Lock/Unlock -->
          <Button
            v-if="!isUnlocked(wallet.baseAddress)"
            variant="outline"
            @click="emit('unlock', wallet.baseAddress)"
          >
            <LockIcon />
            Unlock
          </Button>
          <Button
            v-else
            variant="outline"
            class="border-zenon-green/50 bg-zenon-green/5 text-zenon-green hover:bg-zenon-green/10"
            @click="emit('lock', wallet.baseAddress)"
          >
            <LockOpenIcon />
            Lock
          </Button>
          <Button variant="outline" @click="handleDeriveAccount(wallet.baseAddress)">
            <PlusIcon class="mr-1" />
            Account
          </Button>

          <!-- More Actions Menu -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="icon">
                <MoreVerticalIcon class="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                v-if="hiddenAccountCount(wallet) > 0"
                @click="toggleShowHidden(wallet.baseAddress)"
              >
                <EyeOffIcon v-if="!showHiddenByWallet[wallet.baseAddress]" class="mr-2 h-4 w-4" />
                <EyeIcon v-else class="mr-2 h-4 w-4" />
                {{
                  showHiddenByWallet[wallet.baseAddress]
                    ? 'Hide hidden accounts'
                    : `Show ${hiddenAccountCount(wallet)} hidden account${hiddenAccountCount(wallet) === 1 ? '' : 's'}`
                }}
              </DropdownMenuItem>
              <DropdownMenuSeparator v-if="hiddenAccountCount(wallet) > 0" />
              <DropdownMenuItem @click="handleExportMnemonic(wallet.baseAddress)">
                <KeyIcon class="mr-2 h-4 w-4" />
                Export Mnemonic
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                class="text-destructive focus:text-destructive"
                @click="emit('delete', wallet.baseAddress)"
              >
                <TrashIcon class="mr-2 h-4 w-4" />
                Delete Wallet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <!-- Accounts Section -->
        <AccountList
          :accounts="wallet.accounts"
          :active-account-address="activeAccountAddress"
          :can-derive="isUnlocked(wallet.baseAddress)"
          :show-hidden="!!showHiddenByWallet[wallet.baseAddress]"
          editable
          compact
          @derive-account="emit('deriveAccount', wallet.baseAddress)"
          @select-account="(address) => emit('selectAccount', address)"
          @rename-account="
            (address, newLabel) => emit('renameAccount', wallet.baseAddress, address, newLabel)
          "
          @toggle-hidden="
            (address, hidden) => emit('toggleHidden', wallet.baseAddress, address, hidden)
          "
        />
      </div>
    </div>

    <!-- Add Wallet Dialog -->
    <Dialog v-model:open="addWalletDialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader v-if="addWalletMode === 'choice'">
          <DialogTitle>Add Wallet</DialogTitle>
        </DialogHeader>

        <!-- Choice Mode -->
        <div v-if="addWalletMode === 'choice'" class="space-y-4">
          <Button class="w-full" size="lg" @click="addWalletMode = 'create'">
            Create New Wallet
          </Button>
          <Button class="w-full" size="lg" variant="outline" @click="addWalletMode = 'import'">
            Import Existing Wallet
          </Button>
        </div>

        <!-- Create Mode -->
        <CreateWalletForm
          v-else-if="addWalletMode === 'create'"
          @success="handleWalletCreated"
          @cancel="handleAddWalletCancel"
        />

        <!-- Import Mode -->
        <ImportWalletForm
          v-else-if="addWalletMode === 'import'"
          @success="handleWalletImported"
          @cancel="handleAddWalletCancel"
        />
      </DialogContent>
    </Dialog>
  </div>
</template>

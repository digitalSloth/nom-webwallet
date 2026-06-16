<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import type {Wallet} from '@/types'
import WalletList from './WalletList.vue'
import UnlockWalletDialog from './UnlockWalletDialog.vue'
import ExportMnemonicDialog from './ExportMnemonicDialog.vue'
import NetworkSelector from './NetworkSelector.vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from 'nom-ui'
import {MoonIcon, SettingsIcon, SunIcon} from 'lucide-vue-next'

export interface SettingsDialogProps {
  open: boolean
  wallets: Wallet[]
  activeAccountAddress: string | null
  unlockedWallets: string[]
  currentNode: string
  theme: 'light' | 'dark'
}

const props = defineProps<SettingsDialogProps>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  unlock: [address: string, password: string]
  lock: [address: string]
  'delete-wallet': [address: string]
  'rename-wallet': [address: string, newName: string]
  'export-mnemonic': [address: string]
  'derive-account': [walletAddress: string]
  'select-account': [address: string]
  'rename-account': [walletAddress: string, accountAddress: string, newLabel: string]
  'toggle-account-hidden': [walletAddress: string, accountAddress: string, hidden: boolean]
  'select-network': [nodeUrl: string]
  'update-network-config': [chainId: number, networkId: number]
  'toggle-theme': []
  'wallet-added': [address: string]
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    // Prevent closing the settings dialog if a nested dialog is open
    if (!value && (exportDialogVisible.value || unlockDialogVisible.value)) {
      return
    }
    emit('update:open', value)
  },
})

// Unlock dialog state
const unlockDialogVisible = ref(false)
const walletToUnlock = ref<{ address: string; name: string } | null>(null)
const unlockError = ref<string | null>(null)

// Export mnemonic dialog state
const exportDialogVisible = ref(false)
const exportMnemonic = ref<{ mnemonic: string; name: string } | null>(null)

// Watch for wallet unlock success
watch(
  () => props.unlockedWallets,
  (newUnlockedWallets) => {
    if (walletToUnlock.value && newUnlockedWallets.includes(walletToUnlock.value.address)) {
      unlockDialogVisible.value = false
      walletToUnlock.value = null
      unlockError.value = null
    }
  }
)

function handleUnlockRequest(address: string) {
  const wallet = props.wallets.find((w) => w.baseAddress === address)
  if (wallet) {
    walletToUnlock.value = { address, name: wallet.name }
    unlockError.value = null
    unlockDialogVisible.value = true
  }
}

async function handleUnlock(password: string) {
  if (!walletToUnlock.value) return

  unlockError.value = null
  emit('unlock', walletToUnlock.value.address, password)
}

function handleExportMnemonicRequest(address: string) {
  const wallet = props.wallets.find((w) => w.baseAddress === address)
  if (wallet) {
    emit('export-mnemonic', address)
  }
}

function showExportDialog(address: string, mnemonic: string) {
  const wallet = props.wallets.find((w) => w.baseAddress === address)
  if (wallet) {
    exportMnemonic.value = { mnemonic, name: wallet.name }
    exportDialogVisible.value = true
  }
}

function setUnlockError(error: string) {
  unlockError.value = error
}

defineExpose({
  showExportDialog,
  setUnlockError,
})
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-w-3xl">
      <DialogHeader>
        <div class="flex items-center gap-3">
          <div class="rounded-full bg-primary/10 p-2">
            <SettingsIcon class="h-5 w-5 text-primary" />
          </div>
          <div>
            <DialogTitle>Settings</DialogTitle>
          </div>
        </div>
      </DialogHeader>

      <Tabs default-value="wallet" class="w-full">
        <TabsList class="mb-4 grid w-full grid-cols-2">
          <TabsTrigger value="wallet"> Wallet </TabsTrigger>
          <TabsTrigger value="network"> Network </TabsTrigger>
        </TabsList>

        <TabsContent value="wallet">
          <!-- Wallet List with embedded Account Lists -->
          <WalletList
            :wallets="wallets"
            :unlocked-wallets="unlockedWallets"
            :active-account-address="activeAccountAddress"
            @unlock="handleUnlockRequest"
            @lock="(address) => emit('lock', address)"
            @delete="(address) => emit('delete-wallet', address)"
            @rename="(address, newName) => emit('rename-wallet', address, newName)"
            @export-mnemonic="handleExportMnemonicRequest"
            @derive-account="(walletAddress) => emit('derive-account', walletAddress)"
            @select-account="(address) => emit('select-account', address)"
            @rename-account="
              (walletAddress, accountAddress, newLabel) =>
                emit('rename-account', walletAddress, accountAddress, newLabel)
            "
            @toggle-hidden="
              (walletAddress, accountAddress, hidden) =>
                emit('toggle-account-hidden', walletAddress, accountAddress, hidden)
            "
            @wallet-added="(address) => emit('wallet-added', address)"
          />
        </TabsContent>

        <TabsContent value="network">
          <NetworkSelector
            :current-node="currentNode"
            @select="(nodeUrl) => emit('select-network', nodeUrl)"
            @update-network-config="
              (chainId, networkId) => emit('update-network-config', chainId, networkId)
            "
          />
        </TabsContent>

        <TabsContent value="ui">
          <div class="space-y-2">
            <label class="text-sm font-medium">Theme</label>
            <Button @click="emit('toggle-theme')" variant="outline" class="w-full justify-start">
              <SunIcon v-if="theme === 'dark'" class="mr-2 h-4 w-4" />
              <MoonIcon v-else class="mr-2 h-4 w-4" />
              {{ theme === 'dark' ? 'Light Mode' : 'Dark Mode' }}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>

  <!-- Nested Dialogs (rendered with higher z-index) -->
  <Teleport to="body">
    <!-- Unlock Dialog -->
    <UnlockWalletDialog
      v-if="unlockDialogVisible && walletToUnlock"
      :open="unlockDialogVisible"
      :wallet-address="walletToUnlock.address"
      :wallet-name="walletToUnlock.name"
      :unlock-error="unlockError"
      @unlock="handleUnlock"
      @update:open="
        (value) => {
          unlockDialogVisible = value
        }
      "
      @cancel="
        () => {
          unlockDialogVisible = false
          unlockError = null
        }
      "
    />

    <!-- Export Mnemonic Dialog -->
    <ExportMnemonicDialog
      v-if="exportDialogVisible && exportMnemonic"
      :mnemonic="exportMnemonic.mnemonic"
      :wallet-name="exportMnemonic.name"
      @close="exportDialogVisible = false"
    />
  </Teleport>
</template>

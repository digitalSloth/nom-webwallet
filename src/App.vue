<script setup lang="ts">
import {onMounted, provide, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {truncateAddress, useAccount, useNetwork, useWallet} from '@/core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Toaster,
  useTheme,
  useToast
} from 'nom-ui'
import NetworkIndicator from '@/components/NetworkIndicator.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import UnlockWalletDialog from '@/components/UnlockWalletDialog.vue'
import AccountList from '@/components/AccountList.vue'
import {ChevronDownIcon, LockIcon, LockOpenIcon, SettingsIcon} from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const { initTheme } = useTheme()
const toast = useToast()

// Use composables
const wallet = useWallet()
const account = useAccount(() => wallet.activeAccountAddress.value)
const network = useNetwork()

// Global unlock dialog state
const showUnlockDialog = ref(false)
const unlockError = ref<string | null>(null)
const pendingNavigation = ref<string | null>(null)

/**
 * Request unlock with optional navigation
 */
function requestUnlock(path?: string) {
  unlockError.value = null
  pendingNavigation.value = path || null
  showUnlockDialog.value = true
}

// Provide requestUnlock for child components
provide('requestUnlock', requestUnlock)

// UI state
const showAccountSelector = ref(false)
const showSettings = ref(false)
const showDeleteConfirm = ref(false)
const walletToDelete = ref<string | null>(null)
const settingsDialogRef = ref<InstanceType<typeof SettingsDialog> | null>(null)

onMounted(async () => {
  await initTheme()

  // Shared one-time load; the router guard may have already triggered it.
  // Wallet-state redirects (no wallet → /setup) are owned by the router guard.
  await wallet.ensureLoaded()

  if (wallet.hasWallets.value) {
    // Initialize network
    await network.initialize()

    // Load account data if account is active
    if (wallet.activeAccountAddress.value) {
      await account.loadAccountData()
    }
  }
})

// Watch for route changes to reload wallet data (in case user just finished setup)
watch(() => route.path, async (newPath) => {
  if (newPath !== '/setup') {
    await wallet.loadWalletData()

    // Initialize network if we have wallets
    if (wallet.hasWallets.value) {
      await network.initialize()
    }

    if (wallet.activeAccountAddress.value) {
      await account.loadAccountData()
    }
  }
})

// Watch for active account changes to update account data
watch(() => wallet.activeAccountAddress.value, async (newAddress) => {
  if (newAddress) {
    await account.loadAccountData()
  }
})

// Watch for wallet deletion - redirect to setup if no wallets remain
watch(() => wallet.hasWallets.value, (hasWallets) => {
  if (!hasWallets && route.path !== '/setup') {
    router.push('/setup')
  }
})

// The router guard redirects a locked user off a protected route to "/" with
// ?unlock=<target>. Open the unlock dialog for that target, then clear the query.
watch(
  () => route.query.unlock,
  (unlock) => {
    if (typeof unlock === 'string' && unlock) {
      requestUnlock(unlock)
      const query = { ...route.query }
      delete query.unlock
      router.replace({ path: route.path, query })
    }
  },
  { immediate: true }
)

// Wallet management handlers
async function handleUnlock(address: string, password: string) {
  try {
    await wallet.unlockWallet(address, password)
  } catch (error) {
    console.error('Failed to unlock wallet:', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to unlock wallet. Please check your password.'
    settingsDialogRef.value?.setUnlockError(errorMessage)
  }
}

async function handleQuickUnlock(password: string) {
  if (!wallet.activeWallet.value) return

  try {
    unlockError.value = null
    await wallet.unlockWallet(wallet.activeWallet.value.baseAddress, password)

    toast.show('Wallet unlocked!', 'success')

    // Success - close dialog
    showUnlockDialog.value = false

    // Navigate if there's a pending navigation
    if (pendingNavigation.value) {
      router.push(pendingNavigation.value)
      pendingNavigation.value = null
    }
  } catch (error) {
    unlockError.value = error instanceof Error
      ? error.message
      : 'Failed to unlock wallet. Please check your password.'
  }
}

function handleCancelUnlock() {
  showUnlockDialog.value = false
  unlockError.value = null
  pendingNavigation.value = null
}


function handleLock(address: string) {
  wallet.lockWallet(address)
}

async function handleRenameWallet(address: string, newName: string) {
  await wallet.renameWallet(address, newName)
}

function requestDeleteWallet(address: string) {
  walletToDelete.value = address
  showDeleteConfirm.value = true
}

async function confirmDeleteWallet() {
  if (!walletToDelete.value) return
  await wallet.deleteWallet(walletToDelete.value)
  showDeleteConfirm.value = false
  walletToDelete.value = null
}

async function handleExportMnemonic(address: string) {
  try {
    const mnemonic = wallet.exportMnemonic(address)
    settingsDialogRef.value?.showExportDialog(address, mnemonic)
  } catch {
    toast.show('Failed to export mnemonic. Make sure the wallet is unlocked.', 'error')
  }
}

async function handleDeriveAccount(walletAddress: string) {
  try {
    await wallet.deriveAccount(walletAddress)
  } catch {
    toast.show('Failed to derive account. Make sure the wallet is unlocked.', 'error')
  }
}

async function handleSelectAccount(address: string) {
  await wallet.setActiveAccount(address)
}

async function handleRenameAccount(
  walletAddress: string,
  accountAddress: string,
  newLabel: string
) {
  await wallet.renameAccount(walletAddress, accountAddress, newLabel)
}

async function handleToggleAccountHidden(
  walletAddress: string,
  accountAddress: string,
  hidden: boolean
) {
  try {
    await wallet.setAccountHidden(walletAddress, accountAddress, hidden)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update account visibility'
    toast.show(message, 'error')
  }
}

async function handleNetworkChange(nodeUrl: string) {
  // NetworkSelector calls network.changeNode() directly before emitting 'select',
  // so skip if already on this node to avoid a redundant disconnect/reconnect.
  if (nodeUrl === network.currentNode.value) return
  await network.changeNode(nodeUrl)
}

async function handleNetworkConfigChange(chainId: number, networkId: number) {
  // NetworkSelector calls network.updateNetworkConfig() directly (and reports
  // the result) before emitting, so skip if the config already matches to avoid
  // a redundant SDK update and storage write.
  if (chainId === network.chainId.value && networkId === network.networkId.value) return
  await network.updateNetworkConfig(chainId, networkId)
}

function handleThemeToggle() {
  const { toggleTheme } = useTheme()
  toggleTheme()
}

async function handleWalletAdded(address: string) {
  // Reload wallet data to include the newly added wallet
  await wallet.loadWalletData()
  // Optionally set the new wallet as active
  await wallet.setActiveWallet(address)
}
</script>

<template>
  <div class="min-h-screen">
    <Toaster />
    <!-- Only show header if not on setup page -->
    <template v-if="route.path !== '/setup'">
      <header class="border-b p-4">
        <div class="container mx-auto flex justify-between items-center">
          <!-- Left: Wallet Name, Account Selector, and Address -->
          <div class="flex items-center gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h1 class="text-xl font-bold">{{ wallet.activeWallet.value?.name || 'NoM Wallet' }}</h1>

                <!-- Account Selector Popover -->
                <Popover v-model:open="showAccountSelector">
                  <PopoverTrigger as-child>
                    <button
                      class="text-muted-foreground hover:text-foreground transition-colors p-1"
                      title="Select Account"
                    >
                      <ChevronDownIcon/>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="p-3">
                    <AccountList
                      v-if="wallet.activeWallet.value"
                      :accounts="wallet.activeWallet.value.accounts.filter(a => !a.hidden)"
                      :active-account-address="wallet.activeAccountAddress.value"
                      :can-derive="false"
                      compact
                      @select-account="(address) => {
                        handleSelectAccount(address)
                        showAccountSelector = false
                      }"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <p v-if="wallet.activeAccountAddress.value" class="text-sm text-muted-foreground font-mono">
                {{ truncateAddress(wallet.activeAccountAddress.value) }}
              </p>
            </div>
          </div>

          <!-- Right: Lock, Network Indicator, and Settings -->
          <div class="flex items-center gap-2">
            <!-- Lock/Unlock Button -->
            <button
              v-if="wallet.isActiveWalletUnlocked.value"
              @click="handleLock(wallet.activeWallet.value!.baseAddress)"
              class="text-zenon-green hover:text-zenon-green/80 transition-colors p-2"
              title="Lock Wallet"
            >
              <LockOpenIcon class="w-5 h-5" />
            </button>
            <button
              v-else-if="wallet.activeWallet.value"
              @click="() => requestUnlock()"
              class="text-muted-foreground hover:text-foreground transition-colors p-2"
              title="Unlock Wallet"
            >
              <LockIcon class="w-5 h-5" />
            </button>

            <!-- Network Indicator (read-only) -->
            <div class="p-2">
              <NetworkIndicator
                :connected="network.isConnected.value"
              />
            </div>

            <!-- Settings Button -->
            <button
              @click="showSettings = true"
              class="text-muted-foreground hover:text-foreground transition-colors p-2"
              title="Settings"
            >
              <SettingsIcon/>
            </button>
          </div>
        </div>
      </header>

      <main class="container mx-auto p-6">
        <router-view :key="wallet.activeAccountAddress.value || route.fullPath" />
      </main>
    </template>

    <!-- Setup page gets full screen -->
    <router-view v-else />

    <!-- Unlock Dialog -->
    <UnlockWalletDialog
      v-if="wallet.activeWallet.value"
      v-model:open="showUnlockDialog"
      :wallet-address="wallet.activeWallet.value.baseAddress"
      :wallet-name="wallet.activeWallet.value.name"
      :unlock-error="unlockError"
      @unlock="handleQuickUnlock"
      @cancel="handleCancelUnlock"
    />

    <!-- Settings Dialog -->
    <SettingsDialog
      ref="settingsDialogRef"
      v-model:open="showSettings"
      :wallets="wallet.wallets.value"
      :active-account-address="wallet.activeAccountAddress.value"
      :unlocked-wallets="wallet.unlockedWallets.value"
      :current-node="network.currentNode.value"
      :theme="useTheme().theme.value"
      @unlock="handleUnlock"
      @lock="handleLock"
      @delete-wallet="requestDeleteWallet"
      @rename-wallet="handleRenameWallet"
      @export-mnemonic="handleExportMnemonic"
      @derive-account="handleDeriveAccount"
      @select-account="handleSelectAccount"
      @rename-account="handleRenameAccount"
      @toggle-account-hidden="handleToggleAccountHidden"
      @select-network="handleNetworkChange"
      @update-network-config="handleNetworkConfigChange"
      @toggle-theme="handleThemeToggle"
      @wallet-added="handleWalletAdded"
    />

    <!-- Delete wallet confirmation dialog -->
    <Dialog :open="showDeleteConfirm" @update:open="showDeleteConfirm = $event">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Wallet</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete this wallet? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" @click="showDeleteConfirm = false">Cancel</Button>
          <Button variant="destructive" @click="confirmDeleteWallet">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

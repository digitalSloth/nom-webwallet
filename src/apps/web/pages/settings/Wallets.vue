<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Address, Amount, Badge, Button, Input, Switch, useToast } from 'nom-ui'
import { CheckIcon, PencilIcon, XIcon } from 'lucide-vue-next'
import { useAccountBalances, useWallet } from '@/core'
import { shortAddress } from '@/shared/lib/format'
import ChangePasswordDialog from '../../components/ChangePasswordDialog.vue'
import ExportPhraseDialog from '../../components/ExportPhraseDialog.vue'
import RemoveWalletDialog from '../../components/RemoveWalletDialog.vue'
import UnlockDialog from '../../components/UnlockDialog.vue'
import { canManage, useWalletDialog } from '../../lib/wallet-dialog'

const wallet = useWallet()
const toast = useToast()
const dialogs = useWalletDialog(wallet)

const busy = ref(false)

function isUnlocked(address: string): boolean {
  return wallet.unlockedWallets.value.includes(address)
}

function sortedAccounts(address: string) {
  const accounts = wallet.wallets.value.find((w) => w.baseAddress === address)?.accounts ?? []
  return [...accounts].sort((a, b) => a.index - b.index)
}

function visibleCount(address: string): number {
  return sortedAccounts(address).filter((a) => !a.hidden).length
}

async function run(address: string, action: () => Promise<void>): Promise<void> {
  if (busy.value || !canManage(wallet, address)) return
  busy.value = true
  try {
    await action()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Something went wrong', 'error')
  } finally {
    busy.value = false
  }
}

// Balances of every account of every unlocked wallet. Locked wallets read nothing.
const unlockedAddresses = computed(() =>
  wallet.wallets.value
    .filter((w) => isUnlocked(w.baseAddress))
    .flatMap((w) => w.accounts.map((a) => a.address))
)
const { balances, load } = useAccountBalances(() => unlockedAddresses.value)
watch(
  () => unlockedAddresses.value.join(','),
  () => void load(),
  { immediate: true }
)

// Inline wallet rename: one wallet at a time
const renamingWallet = ref<string | null>(null)
const walletNameInput = ref('')
const walletNameTrimmed = computed(() => walletNameInput.value.trim())

function currentName(address: string): string | undefined {
  return wallet.wallets.value.find((w) => w.baseAddress === address)?.name
}

const canSaveWalletName = computed(
  () =>
    renamingWallet.value !== null &&
    walletNameTrimmed.value !== '' &&
    walletNameTrimmed.value !== currentName(renamingWallet.value)
)

async function startWalletRename(address: string): Promise<void> {
  renamingWallet.value = address
  walletNameInput.value = currentName(address) ?? ''
  await nextTick()
  document.getElementById('rename-wallet')?.focus()
}

function cancelWalletRename(): void {
  renamingWallet.value = null
}

async function saveWalletRename(): Promise<void> {
  const address = renamingWallet.value
  const name = walletNameTrimmed.value
  if (address === null || !canSaveWalletName.value) return
  await run(address, async () => {
    await wallet.renameWallet(address, name)
    renamingWallet.value = null
  })
}

// Inline account rename: one row at a time
const editing = ref<string | null>(null)
const editInput = ref('')
const editTrimmed = computed(() => editInput.value.trim())

async function startEdit(accountAddress: string, label: string | undefined): Promise<void> {
  editing.value = accountAddress
  editInput.value = label ?? ''
  await nextTick()
  document.getElementById('rename-account')?.focus()
}

function cancelEdit(): void {
  editing.value = null
}

async function saveEdit(address: string): Promise<void> {
  const accountAddress = editing.value
  const label = editTrimmed.value
  if (accountAddress === null || label === '') return
  await run(address, async () => {
    await wallet.renameAccount(address, accountAddress, label)
    editing.value = null
  })
}

function toggleVisible(address: string, accountAddress: string, on: boolean): Promise<void> {
  return run(address, () => wallet.setAccountHidden(address, accountAddress, !on))
}

function addAccount(address: string): Promise<void> {
  return run(address, () => wallet.deriveAccount(address))
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <p class="grow text-sm text-muted-foreground">
      {{
        wallet.wallets.value.length === 1 ? '1 wallet' : `${wallet.wallets.value.length} wallets`
      }}
      in this browser. Each is encrypted with its own password.
    </p>
    <Button as-child variant="outline">
      <RouterLink :to="{ name: 'import-phrase' }">Import wallet</RouterLink>
    </Button>
    <Button as-child>
      <RouterLink :to="{ name: 'create-password' }">Create wallet</RouterLink>
    </Button>
  </div>

  <template v-for="w in wallet.wallets.value" :key="w.baseAddress">
    <section
      v-if="isUnlocked(w.baseAddress)"
      :aria-label="w.name"
      class="@container rounded-xl border bg-card shadow-sm"
    >
      <div class="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <span
          class="flex size-9 items-center justify-center rounded-full bg-accent font-semibold text-primary"
        >
          {{ w.name.charAt(0).toUpperCase() }}
        </span>
        <div class="flex min-w-0 grow flex-col gap-0.5">
          <div v-if="renamingWallet === w.baseAddress" class="flex items-center gap-2">
            <Input
              id="rename-wallet"
              v-model="walletNameInput"
              class="h-8 max-w-[260px] min-w-0"
              aria-label="Wallet name"
              :disabled="busy"
              @keydown.enter.prevent="saveWalletRename"
              @keydown.escape="cancelWalletRename"
            />
            <Button size="sm" :disabled="!canSaveWalletName || busy" @click="saveWalletRename">
              Save
            </Button>
            <Button variant="ghost" size="sm" @click="cancelWalletRename">Cancel</Button>
          </div>
          <span v-else class="flex items-center gap-2">
            <h2 class="text-base font-semibold">{{ w.name }}</h2>
            <Badge variant="success">Unlocked</Badge>
          </span>
          <Address :address="w.baseAddress" :start="8" :end="6" copy class="text-xs" />
        </div>
        <span class="flex flex-wrap gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="startWalletRename(w.baseAddress)"
          >
            Rename
          </Button>
          <Button variant="outline" size="sm" @click="wallet.lockWallet(w.baseAddress)">
            Lock
          </Button>
        </span>
      </div>

      <div class="relative overflow-x-auto">
        <table class="w-full min-w-[680px] border-collapse text-sm">
          <thead>
            <tr>
              <th class="px-5 py-2.5 text-left text-ledger font-medium text-muted-foreground">
                Account
              </th>
              <th class="px-3 py-2.5 text-left text-ledger font-medium text-muted-foreground">
                Address
              </th>
              <th class="px-3 py-2.5 text-right text-ledger font-medium text-muted-foreground">
                ZNN
              </th>
              <th class="px-3 py-2.5 text-right text-ledger font-medium text-muted-foreground">
                QSR
              </th>
              <th class="px-3 py-2.5 text-center text-ledger font-medium text-muted-foreground">
                Shown
              </th>
              <th class="px-5 py-2.5"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="a in sortedAccounts(w.baseAddress)"
              :key="a.address"
              class="border-t"
              :class="{ 'opacity-55': a.hidden }"
            >
              <td class="px-5 py-2.5 font-semibold">
                <span v-if="editing === a.address" class="flex items-center gap-1">
                  <Input
                    id="rename-account"
                    v-model="editInput"
                    class="h-8"
                    aria-label="Account name"
                    :disabled="busy"
                    @keydown.enter.prevent="saveEdit(w.baseAddress)"
                    @keydown.escape="cancelEdit"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Save name"
                    :disabled="editTrimmed === '' || busy"
                    @click="saveEdit(w.baseAddress)"
                  >
                    <CheckIcon />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Cancel" @click="cancelEdit">
                    <XIcon />
                  </Button>
                </span>
                <template v-else>{{ a.label }}</template>
              </td>
              <td class="px-3 py-2.5">
                <Address :address="a.address" :start="8" :end="6" copy class="text-[13px]" />
              </td>
              <td class="px-3 py-2.5 text-right">
                <Amount v-if="balances[a.address]" :value="balances[a.address].znn" :decimals="2" />
              </td>
              <td class="px-3 py-2.5 text-right">
                <Amount v-if="balances[a.address]" :value="balances[a.address].qsr" :decimals="2" />
              </td>
              <td class="px-3 py-2.5 text-center">
                <Switch
                  :model-value="!a.hidden"
                  :aria-label="`Show ${a.label} in the account selector`"
                  :disabled="busy || (!a.hidden && visibleCount(w.baseAddress) <= 1)"
                  @update:model-value="toggleVisible(w.baseAddress, a.address, $event)"
                />
              </td>
              <td class="px-5 py-2.5 text-right">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Rename ${a.label}`"
                  :disabled="busy"
                  @click="startEdit(a.address, a.label)"
                >
                  <PencilIcon />
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex flex-wrap items-center gap-3 border-t px-5 py-3.5">
        <Button variant="outline" size="sm" :disabled="busy" @click="addAccount(w.baseAddress)">
          Add account
        </Button>
        <span class="text-xs text-muted-foreground">
          Switched-off accounts are hidden from the account selector.
        </span>
      </div>

      <div class="grid grid-cols-1 border-t @min-[660px]:grid-cols-3">
        <button
          type="button"
          class="flex flex-col items-start gap-0.5 px-5 py-3.5 text-left"
          @click="dialogs.show('export', w.baseAddress)"
        >
          <span class="text-sm font-semibold">Export recovery phrase</span>
          <span class="text-xs text-muted-foreground">Password required</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-start gap-0.5 border-t px-5 py-3.5 text-left @min-[660px]:border-t-0 @min-[660px]:border-l"
          @click="dialogs.show('password', w.baseAddress)"
        >
          <span class="text-sm font-semibold">Change password</span>
          <span class="text-xs text-muted-foreground">Re-encrypts this wallet</span>
        </button>
        <button
          type="button"
          class="flex flex-col items-start gap-0.5 border-t px-5 py-3.5 text-left text-destructive @min-[660px]:border-t-0 @min-[660px]:border-l"
          @click="dialogs.show('remove', w.baseAddress)"
        >
          <span class="text-sm font-semibold">Remove wallet</span>
          <span class="text-xs text-muted-foreground">From this browser only</span>
        </button>
      </div>
    </section>

    <section
      v-else
      :aria-label="w.name"
      class="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-5 py-4"
    >
      <span class="flex size-9 items-center justify-center rounded-full bg-muted font-semibold">
        {{ w.name.charAt(0).toUpperCase() }}
      </span>
      <div class="flex grow flex-col gap-0.5">
        <span class="flex items-center gap-2">
          <h2 class="text-base font-semibold">{{ w.name }}</h2>
          <Badge variant="secondary">Locked</Badge>
        </span>
        <span class="text-xs text-muted-foreground">
          {{ w.accounts.length === 1 ? '1 account' : `${w.accounts.length} accounts` }} ·
          <span class="font-mono">{{ shortAddress(w.baseAddress) }}</span>
        </span>
      </div>
      <Button variant="outline" size="sm" @click="dialogs.show('unlock', w.baseAddress)">
        Unlock to manage
      </Button>
    </section>
  </template>

  <template v-if="dialogs.dialog.value">
    <UnlockDialog
      v-if="dialogs.dialog.value.kind === 'unlock'"
      :address="dialogs.dialog.value.address"
      @close="dialogs.close()"
    />
    <ExportPhraseDialog
      v-else-if="dialogs.dialog.value.kind === 'export'"
      :address="dialogs.dialog.value.address"
      @close="dialogs.close()"
    />
    <ChangePasswordDialog
      v-else-if="dialogs.dialog.value.kind === 'password'"
      :address="dialogs.dialog.value.address"
      @close="dialogs.close()"
    />
    <RemoveWalletDialog v-else :address="dialogs.dialog.value.address" @close="dialogs.close()" />
  </template>
</template>

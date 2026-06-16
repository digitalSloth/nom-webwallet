<script setup lang="ts">
import {computed, ref} from 'vue'
import type {WalletAccount} from '@/types'
import {truncateAddress} from '@/core'
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from 'nom-ui'
import {CheckIcon, EyeIcon, EyeOffIcon, PencilIcon, PlusIcon} from 'lucide-vue-next'

interface Props {
  accounts: WalletAccount[]
  activeAccountAddress?: string | null
  canDerive: boolean
  compact?: boolean
  showHidden?: boolean
  editable?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  deriveAccount: []
  selectAccount: [address: string]
  renameAccount: [address: string, newLabel: string]
  toggleHidden: [address: string, hidden: boolean]
}>()

const editingAccountAddress = ref<string | null>(null)
const editingAccountLabel = ref('')

const displayedAccounts = computed(() => {
  const list = props.showHidden ? props.accounts : props.accounts.filter((a) => !a.hidden)
  return [...list].sort((a, b) => a.index - b.index)
})

const visibleCount = computed(() => props.accounts.filter((a) => !a.hidden).length)

function startEdit(account: WalletAccount) {
  editingAccountAddress.value = account.address
  editingAccountLabel.value = account.label || `Account ${account.index + 1}`
}

function saveEdit(address: string) {
  const label = editingAccountLabel.value.trim()
  if (label) {
    emit('renameAccount', address, label)
  }
  editingAccountAddress.value = null
  editingAccountLabel.value = ''
}

function cancelEdit() {
  editingAccountAddress.value = null
  editingAccountLabel.value = ''
}

function handleRowClick(account: WalletAccount) {
  if (account.hidden) return
  if (account.address === props.activeAccountAddress) return
  if (editingAccountAddress.value === account.address) return
  emit('selectAccount', account.address)
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!compact" class="flex items-center justify-between">
      <h3 class="text-lg font-semibold">Accounts</h3>
      <Button :disabled="!canDerive" @click="emit('deriveAccount')">
        <PlusIcon class="mr-1" />
        Add Account
      </Button>
    </div>

    <div class="space-y-2">
      <Item
        v-for="account in displayedAccounts"
        :key="account.address"
        :class="[
          'flex-nowrap transition-colors',
          account.address === activeAccountAddress ? 'border-primary/50 bg-primary/10' : '',
          account.hidden ? 'opacity-60' : '',
        ]"
        variant="hover"
        size="sm"
        @click="handleRowClick(account)"
      >
        <ItemContent class="min-w-0 flex-1">
          <template v-if="editable && editingAccountAddress === account.address">
            <InputGroup>
              <InputGroupInput
                v-model="editingAccountLabel"
                @click.stop
                @keyup.enter="saveEdit(account.address)"
                @keyup.esc="cancelEdit"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  aria-label="Save"
                  title="Save"
                  size="icon-xs"
                  @click.stop="saveEdit(account.address)"
                >
                  <CheckIcon />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </template>
          <template v-else>
            <div class="flex min-w-0 items-center gap-2">
              <ItemTitle class="truncate">{{
                account.label || `Account ${account.index + 1}`
              }}</ItemTitle>
              <Button
                v-if="editable"
                size="sm"
                variant="ghost"
                class="h-6 w-6 shrink-0 p-0"
                aria-label="Rename account"
                title="Rename"
                @click.stop="startEdit(account)"
              >
                <PencilIcon class="h-3 w-3" />
              </Button>
            </div>
            <ItemDescription class="font-mono">
              {{ truncateAddress(account.address) }}
            </ItemDescription>
          </template>
        </ItemContent>
        <ItemActions v-if="!compact || editable" class="shrink-0">
          <span v-if="!compact" class="text-xs text-muted-foreground"
            >Index {{ account.index }}</span
          >
          <template v-if="editable">
            <Button
              v-if="account.hidden"
              size="sm"
              variant="ghost"
              aria-label="Show account"
              title="Show"
              @click.stop="emit('toggleHidden', account.address, false)"
            >
              <EyeIcon class="mr-1 h-4 w-4" />
              Show
            </Button>
            <Button
              v-else
              size="sm"
              variant="ghost"
              aria-label="Hide account"
              :disabled="visibleCount <= 1"
              :title="visibleCount <= 1 ? 'At least one account must remain visible' : 'Hide'"
              @click.stop="emit('toggleHidden', account.address, true)"
            >
              <EyeOffIcon class="h-4 w-4" />
            </Button>
          </template>
        </ItemActions>
      </Item>
    </div>

    <Button
      v-if="compact && canDerive"
      variant="outline"
      class="w-full"
      :disabled="!canDerive"
      @click="emit('deriveAccount')"
    >
      <PlusIcon class="mr-1" />
      Add Account
    </Button>
  </div>
</template>

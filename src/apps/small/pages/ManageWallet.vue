<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWallet } from '@/core'
import { Badge, Button, Input, Switch, useToast } from 'nom-ui'
import { CheckIcon, ChevronRightIcon, PencilIcon, PlusIcon, XIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'
import { shortAddress } from '@/shared/lib/format'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()
const toast = useToast()

const address = route.params.address as string
const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === address) ?? null)
const unlocked = computed(() => wallet.unlockedWallets.value.includes(address))

const accounts = computed(() =>
  [...(target.value?.accounts ?? [])].sort((a, b) => a.index - b.index)
)
const visibleCount = computed(() => accounts.value.filter((a) => !a.hidden).length)

const busy = ref(false)

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await action()
  } catch (err) {
    toast.show(err instanceof Error ? err.message : 'Something went wrong', 'error')
  } finally {
    busy.value = false
  }
}

// Wallet name
const nameInput = ref(target.value?.name ?? '')
const nameTrimmed = computed(() => nameInput.value.trim())
const canSaveName = computed(
  () => nameTrimmed.value !== '' && nameTrimmed.value !== target.value?.name
)

function saveName(): Promise<void> {
  const name = nameTrimmed.value
  return run(() => wallet.renameWallet(address, name))
}

// Inline account rename: one row at a time
const editing = ref<string | null>(null)
const editInput = ref('')
const editTrimmed = computed(() => editInput.value.trim())
const editField = ref<InstanceType<typeof Input>[]>([])

function startEdit(accountAddress: string, label: string | undefined): void {
  editing.value = accountAddress
  editInput.value = label ?? ''
}

watch(editing, async (value) => {
  if (value === null) return
  await nextTick()
  const el = (editField.value[0] as unknown as { $el?: HTMLElement } | undefined)?.$el
  el?.focus()
})

function cancelEdit(): void {
  editing.value = null
}

async function saveEdit(): Promise<void> {
  const accountAddress = editing.value
  const label = editTrimmed.value
  if (accountAddress === null || label === '') return
  await run(async () => {
    await wallet.renameAccount(address, accountAddress, label)
    editing.value = null
  })
}

function toggleVisible(accountAddress: string, on: boolean): Promise<void> {
  return run(() => wallet.setAccountHidden(address, accountAddress, !on))
}

function addAccount(): Promise<void> {
  return run(() => wallet.deriveAccount(address))
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Manage wallet" @back="router.push({ name: 'settings-wallets' })">
      <Badge :variant="unlocked ? 'success' : 'secondary'">
        {{ unlocked ? 'Unlocked' : 'Locked' }}
      </Badge>
    </PageHeader>

    <div v-if="target" class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="space-y-2">
        <label for="wallet-name" class="text-ledger text-muted-foreground">Wallet name</label>
        <div class="flex gap-2">
          <Input
            id="wallet-name"
            v-model="nameInput"
            :disabled="busy"
            @keydown.enter="canSaveName && saveName()"
          />
          <Button variant="outline" :disabled="!canSaveName || busy" @click="saveName">Save</Button>
        </div>
        <p class="text-xs text-muted-foreground">
          Base address <span class="font-mono">{{ shortAddress(target.baseAddress) }}</span>
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <div class="text-ledger text-muted-foreground">Accounts</div>
          <div class="flex items-center gap-2">
            <span v-if="!unlocked" class="text-xs text-muted-foreground">
              Unlock to add accounts
            </span>
            <Button variant="ghost" size="xs" :disabled="busy || !unlocked" @click="addAccount">
              <PlusIcon /> Add account
            </Button>
          </div>
        </div>
        <ul class="divide-y rounded-lg border">
          <li
            v-for="a in accounts"
            :key="a.address"
            class="flex items-center gap-2 px-3 py-2.5"
            :class="{ 'opacity-55': a.hidden }"
          >
            <template v-if="editing === a.address">
              <Input
                ref="editField"
                v-model="editInput"
                class="h-8 flex-1"
                :disabled="busy"
                @keydown.enter="saveEdit"
                @keydown.escape="cancelEdit"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Save name"
                :disabled="editTrimmed === '' || busy"
                @click="saveEdit"
              >
                <CheckIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Cancel" @click="cancelEdit">
                <XIcon />
              </Button>
            </template>
            <template v-else>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ a.label }}</div>
                <div class="font-mono text-xs text-muted-foreground">
                  {{ shortAddress(a.address) }}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                :aria-label="`Rename ${a.label}`"
                @click="startEdit(a.address, a.label)"
              >
                <PencilIcon />
              </Button>
              <Switch
                :model-value="!a.hidden"
                :aria-label="`Show ${a.label} in account selector`"
                :disabled="busy || (!a.hidden && visibleCount <= 1)"
                @update:model-value="toggleVisible(a.address, $event)"
              />
            </template>
          </li>
        </ul>
        <p class="text-xs text-muted-foreground">
          Switched-off accounts are hidden from the account selector.
        </p>
      </div>

      <ul class="divide-y rounded-lg border">
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-3 text-sm hover:bg-muted"
            @click="router.push({ name: 'export-phrase', params: { address } })"
          >
            Export recovery phrase
            <ChevronRightIcon class="size-4 text-muted-foreground" />
          </button>
        </li>
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-3 text-sm hover:bg-muted"
            @click="router.push({ name: 'change-password', params: { address } })"
          >
            Change password
            <ChevronRightIcon class="size-4 text-muted-foreground" />
          </button>
        </li>
        <li>
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-3 text-sm text-destructive hover:bg-muted"
            @click="router.push({ name: 'remove-wallet', params: { address } })"
          >
            Remove wallet from this device
            <ChevronRightIcon class="size-4" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

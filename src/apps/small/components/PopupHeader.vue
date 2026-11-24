<script setup lang="ts">
import { computed } from 'vue'
import { Button } from 'nom-ui'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  LockIcon,
  LockOpenIcon,
  SettingsIcon,
} from 'lucide-vue-next'
import { useClipboard } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { useWallet } from '@/core'
import { shortAddress } from '@/shared/lib/format'
import { injectSmallHost } from '@/apps/small/host'
import WalletMenu from '@/shared/components/WalletMenu.vue'

const router = useRouter()
const wallet = useWallet()
const host = injectSmallHost()

const walletName = computed(() => wallet.activeWallet.value?.name ?? 'NoM Wallet')
const avatarLetter = computed(() => walletName.value.charAt(0).toUpperCase())
const accountLabel = computed(
  () =>
    wallet.activeWallet.value?.accounts.find(
      (account) => account.address === wallet.activeAccountAddress.value
    )?.label ?? ''
)

// legacy: true keeps copy working in extension pages.
const { copy, copied } = useClipboard({ legacy: true })

function copyAddress(): void {
  const address = wallet.activeAccountAddress.value
  if (address) void copy(address)
}

function manageWallets(): void {
  void router.push({ name: 'settings-wallets' })
}
</script>

<template>
  <header class="flex items-center gap-1 border-b px-3 py-2">
    <div class="flex min-w-0 flex-1 items-center gap-0.5">
      <WalletMenu v-if="wallet.activeWallet.value">
        <button
          type="button"
          class="flex max-w-full min-w-0 items-center gap-2 rounded-md p-1 pr-1.5 text-left hover:bg-muted data-[state=open]:bg-muted"
          aria-label="Choose account"
        >
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold"
          >
            {{ avatarLetter }}
          </span>
          <span class="min-w-0">
            <!-- The wallet name gives way first so the account label stays readable. -->
            <span class="flex min-w-0 text-sm font-medium whitespace-nowrap">
              <span class="min-w-0 truncate">{{ walletName }}</span>
              <span class="ml-0.5 max-w-[60%] shrink-0 truncate">· {{ accountLabel }}</span>
            </span>
            <span
              v-if="wallet.activeAccountAddress.value"
              class="block font-mono text-xs text-muted-foreground"
            >
              {{ shortAddress(wallet.activeAccountAddress.value) }}
            </span>
          </span>
          <ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </WalletMenu>
      <button
        v-else
        type="button"
        class="flex w-full min-w-0 items-center gap-2 rounded-md p-1 text-left hover:bg-muted"
        aria-label="Manage wallets"
        @click="manageWallets"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold"
        >
          {{ avatarLetter }}
        </span>
        <span class="truncate text-sm font-medium">{{ walletName }}</span>
      </button>
      <Button
        v-if="wallet.activeAccountAddress.value"
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-muted-foreground"
        :aria-label="copied ? 'Address copied' : 'Copy address'"
        :title="copied ? 'Copied' : 'Copy address'"
        @click="copyAddress"
      >
        <CheckIcon v-if="copied" class="size-4 text-success" />
        <CopyIcon v-else class="size-4" />
      </Button>
    </div>

    <Button
      variant="ghost"
      size="icon"
      class="text-muted-foreground"
      aria-label="Settings"
      @click="router.push({ name: 'settings' })"
    >
      <SettingsIcon class="size-4" />
    </Button>
    <Button
      v-if="wallet.isActiveWalletUnlocked.value"
      variant="ghost"
      size="icon"
      class="text-success hover:text-success"
      aria-label="Lock wallet"
      @click="wallet.lockAllWallets()"
    >
      <LockOpenIcon class="size-4" />
    </Button>
    <Button
      v-else-if="wallet.activeWallet.value"
      variant="ghost"
      size="icon"
      class="text-muted-foreground"
      aria-label="Unlock wallet"
      @click="() => host.requestUnlock()"
    >
      <LockIcon class="size-4" />
    </Button>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useWallet } from '@/core'
import { Button, Checkbox } from 'nom-ui'
import { Trash2Icon } from 'lucide-vue-next'
import { canManage, WALLET_LOCKED_MESSAGE } from '@/shared/lib/manage-wallet'
import PageHeader from '../components/PageHeader.vue'

const route = useRoute()
const router = useRouter()
const wallet = useWallet()

const address = route.params.address as string
const target = computed(() => wallet.wallets.value.find((w) => w.baseAddress === address) ?? null)

const accountCount = computed(() => {
  const count = target.value?.accounts.length ?? 0
  return count === 1 ? '1 account' : `${count} accounts`
})

const confirmed = ref(false)
const error = ref<string | null>(null)
const busy = ref(false)

const manageRoute = { name: 'manage-wallet', params: { address } }

async function remove(): Promise<void> {
  if (busy.value || !confirmed.value) return
  if (!canManage(wallet, address)) {
    error.value = WALLET_LOCKED_MESSAGE
    return
  }
  busy.value = true
  error.value = null
  try {
    await wallet.deleteWallet(address)
    await router.replace({ name: wallet.hasWallets.value ? 'settings-wallets' : 'welcome' })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not remove the wallet'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Remove wallet" :back-disabled="busy" @back="router.push(manageRoute)" />

    <div v-if="target" class="flex-1 space-y-4 overflow-y-auto p-4">
      <div class="flex flex-col items-center gap-2 text-center">
        <Trash2Icon class="size-10 text-destructive" />
        <h2 class="text-base font-semibold">Remove {{ target.name }}?</h2>
        <p class="text-sm text-muted-foreground">
          This deletes the encrypted wallet and its {{ accountCount }} from this browser. Funds stay
          on chain. You can only get them back with the recovery phrase.
        </p>
      </div>

      <div class="flex items-start gap-2">
        <Checkbox id="remove-confirm" v-model="confirmed" :disabled="busy" class="mt-0.5" />
        <label for="remove-confirm" class="text-sm">
          I have the recovery phrase for {{ target.name }} saved somewhere safe.
        </label>
      </div>
      <router-link
        :to="{ name: 'export-phrase', params: { address } }"
        class="block text-sm text-primary underline"
      >
        Export the recovery phrase first
      </router-link>

      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    </div>

    <footer class="grid grid-cols-2 gap-3 border-t px-4 py-3">
      <Button variant="outline" :disabled="busy" @click="router.push(manageRoute)">Cancel</Button>
      <Button variant="destructive" :disabled="!confirmed || busy" @click="remove">Remove</Button>
    </footer>
  </div>
</template>

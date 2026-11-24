<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAccount, useActivityPages, useWallet } from '@/core'
import { Button, Input } from 'nom-ui'
import { WalletIcon } from 'lucide-vue-next'
import ActivityTable from '../components/ActivityTable.vue'
import { heightsLabel, parseBlockHash } from '../lib/activity'

const router = useRouter()
const wallet = useWallet()
const active = () => wallet.activeAccountAddress.value
const account = useAccount(active)
const pages = useActivityPages(active)

const accountLabel = computed(() => {
  const a = wallet.activeWallet.value?.accounts.find((x) => x.address === active())
  return a ? a.label || `Account ${a.index + 1}` : 'Account'
})

const hashInput = ref('')
const hashInvalid = ref(false)
let wanted = 0

function lookUp(): void {
  const hash = parseBlockHash(hashInput.value)
  hashInvalid.value = hash === null
  if (hash) void router.push({ name: 'tx', params: { hash } })
}

function go(page: number): Promise<void> {
  wanted = page
  return pages.load(page)
}

onMounted(() => void go(0))

// New blocks refresh the first page only; older pages keep the height they were read at.
watch(account.accountHeight, () => {
  if (pages.page.value === 0) void go(0)
})
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <div class="flex flex-wrap items-end gap-3">
      <div class="flex grow flex-col gap-1">
        <h1 class="text-3xl font-semibold tracking-tight">Activity</h1>
        <p class="text-sm text-muted-foreground">
          {{ accountLabel }}'s blocks, newest first, read from the node.
        </p>
      </div>
      <form class="flex w-full flex-col gap-1.5 desktop:w-auto" @submit.prevent="lookUp">
        <div class="flex gap-2">
          <label for="activity-hash" class="sr-only">Look up a transaction hash</label>
          <Input
            id="activity-hash"
            v-model="hashInput"
            placeholder="Paste a transaction hash"
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1 font-mono desktop:w-[300px] desktop:flex-none"
          />
          <Button type="submit" variant="outline">Look up</Button>
        </div>
        <p v-if="hashInvalid" role="alert" class="text-xs text-destructive">
          Enter a 64-character transaction hash.
        </p>
      </form>
    </div>

    <div v-if="!active()" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <template v-else>
      <RouterLink
        v-if="account.unreceivedCount.value > 0"
        :to="{ name: 'receive' }"
        class="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-foreground no-underline"
      >
        <span class="size-2 rounded-full bg-info" aria-hidden="true" />
        <span class="grow">
          <span class="font-mono">{{ account.unreceivedCount.value }}</span>
          {{
            account.unreceivedCount.value === 1
              ? 'incoming transaction not received yet'
              : 'incoming transactions not received yet'
          }}
        </span>
        <span class="font-medium text-info">Receive</span>
      </RouterLink>

      <section aria-label="Account blocks" class="rounded-xl border bg-card shadow-md">
        <ActivityTable
          :rows="pages.rows.value"
          show-hash
          :is-loading="pages.isLoading.value"
          :error="pages.error.value"
          @retry="go(wanted)"
        />
        <div
          v-if="pages.range.value"
          class="flex flex-wrap items-center gap-3 border-t px-5 py-3.5 text-[13px] text-muted-foreground"
        >
          <span class="grow">{{ heightsLabel(pages.range.value, pages.total.value) }}</span>
          <Button
            variant="outline"
            size="sm"
            :disabled="!pages.hasNewer.value || pages.isLoading.value"
            @click="go(pages.page.value - 1)"
          >
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="!pages.hasOlder.value || pages.isLoading.value"
            @click="go(pages.page.value + 1)"
          >
            Older
          </Button>
        </div>
      </section>
    </template>
  </div>
</template>

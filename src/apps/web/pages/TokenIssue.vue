<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { useAccount, useNetwork, useOwnedTokens, useWallet } from '@/core'
import { Address, Alert, Button, Input, Spinner, Switch, TokenIcon } from 'nom-ui'
import { ChevronLeftIcon, WalletIcon } from 'lucide-vue-next'
import { urlHost } from '@/shared/lib/format'
import { runContractAction } from '../lib/contract-action'
import { groupedAmount } from '../lib/owned-tokens'
import { issueMeta, parseIssueForm, permanentNote, znnBalanceOf } from '../lib/token-issue'
import type { IssueForm } from '../lib/token-issue'
import { useIssueSubmit } from '../lib/token-issue-submit'

const router = useRouter()
const wallet = useWallet()
const tokens = useOwnedTokens()
const network = useNetwork()
// WebLayout keys the page by the active account, so this snapshot stays correct.
const address = wallet.activeAccountAddress.value

const accountLabel = computed(() => {
  const a = wallet.activeWallet.value?.accounts.find((x) => x.address === address)
  return a ? a.label || `Account ${a.index + 1}` : 'Account'
})

const account = useAccount(() => address)
const znnBalance = computed(() => znnBalanceOf(account.balances.value, account.isLoading.value))

const name = ref('')
const symbol = ref('')
const domain = ref('')
const decimals = ref('8')
const totalSupply = ref('')
const maxSupply = ref('')
const mintable = ref(true)
const burnable = ref(true)
const utility = ref(false)

function form(): IssueForm {
  return {
    name: name.value,
    symbol: symbol.value,
    domain: domain.value,
    decimals: decimals.value,
    totalSupply: totalSupply.value,
    maxSupply: maxSupply.value,
    mintable: mintable.value,
    burnable: burnable.value,
    utility: utility.value,
  }
}

const key = `token-issue:${address}`

const issue = useIssueSubmit({
  key,
  address,
  form,
  znnBalance: () => znnBalance.value,
  run: (from, params) => {
    const meta = issueMeta(params)
    return runContractAction({
      key,
      from,
      wallet,
      meta,
      node: urlHost(network.currentNode.value),
      send: (w) => tokens.issue(w, from, params, meta),
    })
  },
  navigate: (hash) => router.replace({ name: 'tx', params: { hash } }),
})
const { submitting, actionError, busy, pendingElsewhere } = issue

const check = computed(() => parseIssueForm(form(), znnBalance.value))

onBeforeRouteLeave(() => !issue.submitting.value)

const review = computed(() => {
  const p = check.value.params
  if (!p) return null
  const supply = (raw: bigint) => `${groupedAmount(raw, p.decimals)} ${p.symbol}`
  return {
    name: p.name,
    symbol: p.symbol,
    domain: p.domain || 'None',
    initial: supply(p.totalSupply),
    max: p.mintable ? supply(p.maxSupply) : `${supply(p.maxSupply)} (fixed)`,
    decimals: String(p.decimals),
    mintable: p.mintable ? 'Yes' : 'No',
    burnable: p.burnable ? 'By anyone' : 'Owner only',
    utility: p.utility ? 'Yes' : 'No',
  }
})

const issueLabel = computed(() => {
  const p = check.value.params
  return p ? `Issue ${p.symbol} for 1 ZNN` : 'Issue token'
})
</script>

<template>
  <div class="mx-auto flex max-w-[1160px] flex-col gap-5">
    <RouterLink :to="{ name: 'tokens' }" class="flex items-center gap-1.5 text-[13px] no-underline">
      <ChevronLeftIcon class="size-3.5" />Tokens
    </RouterLink>

    <div class="flex flex-col gap-1">
      <h1 class="text-3xl font-semibold tracking-tight">Issue a token</h1>
      <p class="text-sm text-muted-foreground">
        Create a new ZTS token owned by {{ accountLabel }}. Name, symbol, decimals, domain and the
        utility flag can't be changed later.
      </p>
    </div>

    <div v-if="!address" class="py-12 text-center text-muted-foreground">
      <WalletIcon class="mx-auto mb-3 size-12 opacity-50" />
      <p>No active account. Please create or select a wallet first.</p>
    </div>

    <div v-else class="flex flex-wrap items-start gap-5">
      <form
        class="flex min-w-0 flex-[3_1_480px] flex-col gap-6 rounded-xl border bg-card p-6"
        @submit.prevent
      >
        <fieldset :disabled="busy" class="m-0 flex flex-col gap-6 border-0 p-0">
          <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
            <div class="flex flex-col gap-2">
              <label for="web-issue-name" class="text-ledger text-muted-foreground">Name</label>
              <Input
                id="web-issue-name"
                v-model="name"
                placeholder="MyToken"
                autocomplete="off"
                spellcheck="false"
              />
              <p v-if="check.errors.name" class="text-xs text-destructive">
                {{ check.errors.name }}
              </p>
              <p v-else class="text-xs text-muted-foreground">
                Letters, numbers, and single - . _ between them, up to 40
              </p>
            </div>
            <div class="flex flex-col gap-2">
              <label for="web-issue-symbol" class="text-ledger text-muted-foreground">Symbol</label>
              <Input
                id="web-issue-symbol"
                v-model="symbol"
                placeholder="MYT"
                autocomplete="off"
                spellcheck="false"
                class="font-mono uppercase"
              />
              <p v-if="check.errors.symbol" class="text-xs text-destructive">
                {{ check.errors.symbol }}
              </p>
              <p v-else class="text-xs text-muted-foreground">
                Up to 10 letters or numbers, upper case
              </p>
            </div>
          </div>

          <div class="flex flex-col gap-2">
            <label for="web-issue-domain" class="text-ledger text-muted-foreground"
              >Domain (optional)</label
            >
            <Input
              id="web-issue-domain"
              v-model="domain"
              placeholder="example.com"
              autocomplete="off"
            />
            <p v-if="check.errors.domain" class="text-xs text-destructive">
              {{ check.errors.domain }}
            </p>
          </div>

          <fieldset class="m-0 flex flex-col gap-3 border-0 p-0">
            <legend class="pb-2 text-ledger text-muted-foreground">Supply</legend>
            <label
              class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
            >
              <span class="flex flex-col">
                <span class="font-medium">Mintable</span>
                <span class="text-xs text-muted-foreground"
                  >You can mint more later, up to the max supply</span
                >
              </span>
              <Switch
                :model-value="mintable"
                aria-label="Mintable"
                @update:model-value="mintable = $event === true"
              />
            </label>
            <div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4">
              <div class="flex flex-col gap-2">
                <label for="web-issue-total" class="text-ledger text-muted-foreground"
                  >Initial supply</label
                >
                <Input
                  id="web-issue-total"
                  v-model="totalSupply"
                  numeric
                  placeholder="1000000"
                  autocomplete="off"
                />
                <p v-if="check.errors.totalSupply" class="text-xs text-destructive">
                  {{ check.errors.totalSupply }}
                </p>
              </div>
              <div class="flex flex-col gap-2">
                <label for="web-issue-max" class="text-ledger text-muted-foreground"
                  >Max supply</label
                >
                <Input
                  v-if="mintable"
                  id="web-issue-max"
                  v-model="maxSupply"
                  numeric
                  placeholder="1000000"
                  autocomplete="off"
                />
                <Input
                  v-else
                  id="web-issue-max"
                  :model-value="totalSupply"
                  numeric
                  disabled
                  autocomplete="off"
                />
                <p v-if="check.errors.maxSupply" class="text-xs text-destructive">
                  {{ check.errors.maxSupply }}
                </p>
              </div>
              <div class="flex flex-col gap-2">
                <label for="web-issue-decimals" class="text-ledger text-muted-foreground"
                  >Decimals</label
                >
                <Input
                  id="web-issue-decimals"
                  v-model="decimals"
                  numeric
                  placeholder="8"
                  autocomplete="off"
                />
                <p v-if="check.errors.decimals" class="text-xs text-destructive">
                  {{ check.errors.decimals }}
                </p>
              </div>
            </div>
            <span class="text-xs text-muted-foreground">
              {{
                mintable
                  ? 'Max supply must be at least the initial supply.'
                  : 'Fixed supply: the max supply equals the initial supply and can never change.'
              }}
            </span>
          </fieldset>

          <fieldset class="m-0 flex flex-col gap-3 border-0 p-0">
            <legend class="pb-2 text-ledger text-muted-foreground">Properties</legend>
            <label
              class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
            >
              <span class="flex flex-col">
                <span class="font-medium">Burnable by anyone</span>
                <span class="text-xs text-muted-foreground">Off: only you can burn</span>
              </span>
              <Switch
                :model-value="burnable"
                aria-label="Burnable by anyone"
                @update:model-value="burnable = $event === true"
              />
            </label>
            <label
              class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
            >
              <span class="flex flex-col">
                <span class="font-medium">Utility token</span>
                <span class="text-xs text-muted-foreground"
                  >Marks the token as a utility token on the network</span
                >
              </span>
              <Switch
                :model-value="utility"
                aria-label="Utility token"
                @update:model-value="utility = $event === true"
              />
            </label>
          </fieldset>
        </fieldset>
      </form>

      <aside
        aria-labelledby="web-issue-review"
        class="flex min-w-0 flex-[2_1_320px] flex-col gap-4 rounded-xl border bg-card p-6 shadow-md"
      >
        <h2 id="web-issue-review" class="text-base font-semibold">Review</h2>

        <div class="flex flex-col gap-2 rounded-lg border bg-muted p-3">
          <span class="flex items-center gap-2.5">
            <TokenIcon :symbol="review?.symbol ?? '?'" class="size-8" />
            <span class="flex min-w-0 flex-col">
              <span class="text-sm font-semibold break-all">{{ review?.name ?? '—' }}</span>
              <span class="text-xs break-all text-muted-foreground">{{
                review?.symbol ?? '—'
              }}</span>
            </span>
          </span>
          <span class="text-xs text-muted-foreground">Owner: {{ accountLabel }}</span>
          <Address v-if="address" :address="address" wrap copy />
        </div>

        <dl class="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
          <dt class="self-center text-ledger text-muted-foreground">Name</dt>
          <dd class="m-0 break-all">{{ review ? review.name : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Symbol</dt>
          <dd class="m-0 break-all">{{ review ? review.symbol : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Domain</dt>
          <dd class="m-0 break-all">{{ review ? review.domain : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Initial supply</dt>
          <dd class="m-0 font-mono break-all tabular-nums">{{ review ? review.initial : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Max supply</dt>
          <dd class="m-0 font-mono break-all tabular-nums">{{ review ? review.max : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Decimals</dt>
          <dd class="m-0 break-all">{{ review ? review.decimals : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Mintable</dt>
          <dd class="m-0 break-all">{{ review ? review.mintable : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Burnable</dt>
          <dd class="m-0 break-all">{{ review ? review.burnable : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Utility</dt>
          <dd class="m-0 break-all">{{ review ? review.utility : '—' }}</dd>
          <dt class="self-center text-ledger text-muted-foreground">Issuance fee</dt>
          <dd class="m-0 break-all">1 ZNN, non-refundable</dd>
        </dl>

        <div
          role="note"
          class="flex flex-col gap-2.5 rounded-lg border border-warning p-3 text-[13px] leading-normal"
        >
          {{ permanentNote(mintable) }}
        </div>

        <p v-if="check.errors.fee" class="text-xs text-destructive">{{ check.errors.fee }}</p>

        <p class="text-[13px] text-muted-foreground">
          Issuing needs more plasma than most accounts hold, so it may need PoW on this device
          first.
          <RouterLink :to="{ name: 'plasma' }" class="font-medium text-info">Get plasma</RouterLink>
        </p>

        <Alert v-if="pendingElsewhere" class="flex flex-wrap items-center gap-3 text-sm">
          <span>
            An issue from this account is still pending. You can issue another token after it
            confirms.
          </span>
          <RouterLink :to="{ name: 'activity' }" class="font-semibold underline"
            >Check activity</RouterLink
          >
        </Alert>

        <Button
          class="h-auto min-h-10 w-full py-2 text-center whitespace-normal"
          size="lg"
          :disabled="!check.params || busy || network.nodeDown.value"
          @click="issue.submit"
        >
          <Spinner v-if="submitting" />
          {{ issueLabel }}
        </Button>
        <span class="text-xs text-muted-foreground">
          The initial supply arrives as an incoming transaction for this account.
        </span>

        <Alert
          v-if="actionError"
          variant="destructive"
          class="flex flex-wrap items-center gap-3 text-sm"
        >
          <span>{{ actionError.message }}</span>
          <RouterLink
            v-if="actionError.timeout"
            :to="{ name: 'activity' }"
            class="font-semibold underline"
            >Check activity</RouterLink
          >
        </Alert>
      </aside>
    </div>
  </div>
</template>

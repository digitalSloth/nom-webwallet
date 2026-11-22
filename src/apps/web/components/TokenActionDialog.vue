<script setup lang="ts">
import { computed } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useAccount, useNetwork, useOwnedTokens, useWallet } from '@/core'
import {
  Address,
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  Switch,
  TokenIcon,
} from 'nom-ui'
import { urlHost } from '@/shared/lib/format'
import { runContractAction } from '../lib/contract-action'
import { groupedAmount } from '../lib/owned-tokens'
import { SHEET_DIALOG, SHEET_FOOTER } from '../lib/sheet'
import { useTokenAction } from '../lib/token-action-submit'
import type { TokenActionMode } from '../lib/token-actions'

const props = defineProps<{ mode: TokenActionMode; tokenStandard: string | null }>()
const emit = defineEmits<{ close: [] }>()

const wallet = useWallet()
const network = useNetwork()
// WebLayout keys the page by the active account, so this snapshot stays correct.
const address = wallet.activeAccountAddress.value ?? ''
const account = useAccount(() => address)

const action = useTokenAction({
  mode: props.mode,
  address,
  tokenStandard: props.tokenStandard,
  ownAccounts: () => wallet.activeWallet.value?.accounts.map((a) => a.address) ?? [],
  balances: () => ({ list: account.balances.value, loading: account.isLoading.value }),
  tokens: useOwnedTokens(),
  run: (key, from, meta, send) =>
    runContractAction({
      key,
      from,
      wallet,
      meta,
      node: urlHost(network.currentNode.value),
      send,
    }),
  onSent: () => emit('close'),
})
const {
  facts,
  loading,
  loadError,
  choices,
  balance,
  amount,
  to,
  owner,
  confirmedOwner,
  mintOffConfirmed,
  mintCheck,
  burnCheck,
  updateCheck,
  submitting,
  actionError,
  busy,
  pendingElsewhere,
} = action

onBeforeRouteLeave(() => !action.submitting.value)

function onOpenChange(open: boolean): void {
  if (!open && !submitting.value) emit('close')
}

const symbol = computed(() => facts.value?.symbol ?? '')
const title = computed(() => {
  if (!facts.value) return props.mode === 'burn' ? 'Burn tokens' : 'Token'
  const verb = { mint: 'Mint', burn: 'Burn', manage: 'Manage' }[props.mode]
  return `${verb} ${facts.value.symbol}`
})
const blocked = computed(
  () => mintCheck.value?.blocked ?? burnCheck.value?.blocked ?? updateCheck.value?.blocked ?? null
)

function grouped(raw: bigint): string {
  return facts.value ? groupedAmount(raw, facts.value.decimals) : ''
}

const ctaLabel = computed(() => {
  if (props.mode === 'manage') return 'Save changes'
  const p = props.mode === 'mint' ? mintCheck.value?.params : burnCheck.value?.params
  const verb = props.mode === 'mint' ? 'Mint' : 'Burn'
  return p ? `${verb} ${grouped(p.amount)} ${symbol.value}` : verb
})
const ctaDisabled = computed(
  () => !action.canSubmit.value || busy.value || network.nodeDown.value || blocked.value !== null
)

const ownerChecked = computed(() => {
  const p = updateCheck.value?.params
  return p !== null && p !== undefined && confirmedOwner.value === p.owner
})
function setOwnerChecked(on: boolean): void {
  const p = updateCheck.value?.params
  confirmedOwner.value = on && p ? p.owner : null
}
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent :class="[SHEET_DIALOG, 'overflow-y-auto']">
      <form class="grid gap-[18px]" @submit.prevent="action.submit">
        <DialogHeader>
          <div class="flex items-center gap-3">
            <TokenIcon :symbol="facts ? facts.symbol : '?'" class="size-8" />
            <span class="flex min-w-0 flex-col gap-0.5 text-left">
              <DialogTitle>{{ title }}</DialogTitle>
              <DialogDescription v-if="facts" class="flex flex-wrap items-center gap-1">
                {{ facts.name }} ·
                <Address :address="facts.tokenStandard" :start="8" :end="4" />
              </DialogDescription>
              <DialogDescription v-else>Review this token before you continue.</DialogDescription>
            </span>
          </div>
        </DialogHeader>

        <fieldset :disabled="busy" class="m-0 grid min-w-0 gap-[14px] border-0 p-0">
          <fieldset v-if="tokenStandard === null" class="m-0 flex flex-col gap-2 border-0 p-0">
            <legend class="pb-2 text-ledger text-muted-foreground">Token</legend>
            <div
              v-if="choices.length > 0"
              class="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2"
            >
              <label
                v-for="t in choices"
                :key="t.tokenStandard"
                :class="[
                  'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5',
                  action.zts.value === t.tokenStandard
                    ? 'border-primary bg-accent'
                    : 'border-border',
                ]"
              >
                <input
                  type="radio"
                  name="burn-token"
                  :value="t.tokenStandard"
                  :checked="action.zts.value === t.tokenStandard"
                  class="sr-only"
                  @change="action.select(t.tokenStandard)"
                />
                <TokenIcon :symbol="t.symbol ?? '?'" class="size-7" />
                <span class="text-sm font-semibold">{{ t.symbol }}</span>
              </label>
            </div>
            <div v-else-if="!choices.length && account.isLoading.value" class="flex justify-center">
              <Spinner />
            </div>
            <p v-else class="text-sm text-muted-foreground">
              You hold no tokens that can be burned here.
            </p>
          </fieldset>

          <div v-if="loading" class="flex justify-center py-2"><Spinner /></div>
          <Alert
            v-else-if="loadError"
            variant="destructive"
            class="flex flex-wrap items-center gap-3 text-sm"
          >
            <span>{{ loadError }}</span>
            <Button type="button" variant="outline" size="sm" @click="action.load">Retry</Button>
          </Alert>

          <template v-if="facts && !loading">
            <Alert v-if="blocked" role="alert" variant="destructive" class="text-sm">
              {{ blocked }}
            </Alert>

            <template v-if="mode === 'mint' && mintCheck">
              <div class="flex flex-col gap-1.5">
                <span class="flex items-baseline justify-between gap-2">
                  <label for="token-mint-amount" class="text-ledger text-muted-foreground">
                    Amount to mint
                  </label>
                  <span class="text-xs text-muted-foreground">
                    Mintable up to
                    <span class="font-mono tabular-nums">{{ grouped(mintCheck.remaining) }}</span>
                    {{ symbol }}
                  </span>
                </span>
                <Input id="token-mint-amount" v-model="amount" numeric autocomplete="off" />
                <p v-if="mintCheck.errors.amount" class="text-xs text-destructive">
                  {{ mintCheck.errors.amount }}
                </p>
              </div>
              <div class="flex flex-col gap-1.5">
                <label for="token-mint-to" class="text-ledger text-muted-foreground">Mint to</label>
                <Input
                  id="token-mint-to"
                  v-model="to"
                  class="font-mono text-[13px]"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p v-if="mintCheck.errors.to" class="text-xs text-destructive">
                  {{ mintCheck.errors.to }}
                </p>
                <p v-else-if="mintCheck.toWarning" class="text-xs text-warning">
                  {{ mintCheck.toWarning }}
                </p>
                <p v-else class="text-xs text-muted-foreground">
                  Defaults to this account. Any address works.
                </p>
              </div>
            </template>

            <template v-if="mode === 'burn' && burnCheck">
              <div class="flex flex-col gap-1.5">
                <span class="flex items-baseline justify-between gap-2">
                  <label for="token-burn-amount" class="text-ledger text-muted-foreground">
                    Amount to burn
                  </label>
                  <span class="text-xs text-muted-foreground">
                    Your balance
                    <span class="font-mono tabular-nums">{{
                      balance === null ? '—' : grouped(balance)
                    }}</span>
                    {{ symbol }}
                  </span>
                </span>
                <Input id="token-burn-amount" v-model="amount" numeric autocomplete="off" />
                <p v-if="burnCheck.error" class="text-xs text-destructive">{{ burnCheck.error }}</p>
              </div>
              <p
                role="alert"
                class="rounded-lg border border-destructive px-3 py-2.5 text-[13px] leading-normal"
              >
                Burned tokens are destroyed and reduce the total supply. This can't be
                undone.<template v-if="burnCheck.reducesMax">
                  The max supply drops by the same amount.</template
                >
              </p>
            </template>

            <template v-if="mode === 'manage' && updateCheck">
              <div class="flex flex-col gap-1.5">
                <label for="token-manage-owner" class="text-ledger text-muted-foreground">
                  Owner
                </label>
                <Input
                  id="token-manage-owner"
                  v-model="owner"
                  class="font-mono text-[13px]"
                  autocomplete="off"
                  spellcheck="false"
                />
                <p class="text-xs text-muted-foreground">
                  Transferring ownership gives another address the right to mint and manage this
                  token.
                </p>
                <p v-if="updateCheck.errors.owner" class="text-xs text-destructive">
                  {{ updateCheck.errors.owner }}
                </p>
              </div>
              <div
                v-if="updateCheck.ownerChanged && updateCheck.params"
                class="flex flex-col gap-2.5 rounded-lg bg-muted p-3 text-[13px]"
              >
                <span class="text-ledger text-muted-foreground">New owner</span>
                <Address :address="updateCheck.params.owner" wrap copy />
                <p v-if="updateCheck.ownerWarning" class="text-warning">
                  {{ updateCheck.ownerWarning }}
                </p>
                <label class="flex cursor-pointer items-start gap-2.5 leading-snug">
                  <Checkbox
                    :model-value="ownerChecked"
                    class="mt-0.5"
                    @update:model-value="setOwnerChecked($event === true)"
                  />
                  <span>
                    I've checked this address. I lose the right to mint and manage this token.
                  </span>
                </label>
              </div>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
              >
                <span class="flex flex-col gap-0.5">
                  <span class="font-medium">Mintable</span>
                  <span class="text-xs text-muted-foreground">{{
                    facts.isMintable ? 'Turning this off is permanent' : 'Minting is off for good'
                  }}</span>
                </span>
                <Switch
                  :model-value="action.mintable.value"
                  :disabled="!facts.isMintable"
                  aria-label="Mintable"
                  @update:model-value="action.setMintable($event === true)"
                />
              </label>
              <div
                v-if="updateCheck.disablesMint"
                class="flex flex-col gap-2.5 rounded-lg border border-warning p-3 text-[13px] leading-normal"
              >
                <span>
                  Turning this off is permanent. The max supply becomes the current supply:
                  {{ grouped(facts.totalSupply) }} {{ symbol }}.
                </span>
                <label class="flex cursor-pointer items-start gap-2.5 leading-snug">
                  <Checkbox
                    :model-value="mintOffConfirmed"
                    class="mt-0.5"
                    @update:model-value="mintOffConfirmed = $event === true"
                  />
                  <span>I understand no one can mint this token again.</span>
                </label>
              </div>
              <label
                class="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm"
              >
                <span class="flex flex-col gap-0.5">
                  <span class="font-medium">Burnable by anyone</span>
                  <span class="text-xs text-muted-foreground">Off: only the owner can burn</span>
                </span>
                <Switch
                  :model-value="action.burnable.value"
                  aria-label="Burnable by anyone"
                  @update:model-value="action.burnable.value = $event === true"
                />
              </label>
            </template>

            <div
              v-if="mintCheck?.params"
              class="flex flex-col gap-1.5 rounded-lg bg-muted p-3 text-[13px]"
            >
              <span>
                You mint
                <span class="font-mono tabular-nums">{{ grouped(mintCheck.params.amount) }}</span>
                {{ symbol }} to
              </span>
              <Address :address="mintCheck.params.receiveAddress" wrap />
            </div>
            <div v-if="burnCheck?.params" class="rounded-lg bg-muted p-3 text-[13px]">
              You burn
              <span class="font-mono tabular-nums">{{ grouped(burnCheck.params.amount) }}</span>
              {{ symbol }} from this account.
            </div>
            <div
              v-if="updateCheck?.params && updateCheck.changed"
              class="flex flex-col gap-1.5 rounded-lg bg-muted p-3 text-[13px]"
            >
              <template v-if="updateCheck.ownerChanged">
                <span>New owner</span>
                <Address :address="updateCheck.params.owner" wrap />
              </template>
              <span v-if="updateCheck.disablesMint">Mintable: off, permanently</span>
              <span v-if="updateCheck.burnableChanged">
                Burnable by anyone: {{ updateCheck.params.burnable ? 'on' : 'off' }}
              </span>
            </div>
          </template>
        </fieldset>

        <Alert v-if="pendingElsewhere" class="flex flex-wrap items-center gap-3 text-sm">
          <span>
            A transaction for this token from this account is still pending. Try again after it
            confirms.
          </span>
          <RouterLink :to="{ name: 'activity' }" class="font-semibold underline"
            >Check activity</RouterLink
          >
        </Alert>

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

        <DialogFooter :class="SHEET_FOOTER">
          <Button
            type="button"
            variant="outline"
            class="h-auto min-h-10 whitespace-normal"
            :disabled="submitting"
            @click="emit('close')"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            :variant="mode === 'burn' ? 'destructive' : 'default'"
            class="h-auto min-h-10 whitespace-normal"
            :disabled="ctaDisabled"
          >
            <Spinner v-if="submitting" />
            {{ ctaLabel }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

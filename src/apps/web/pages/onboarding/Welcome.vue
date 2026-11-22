<script setup lang="ts">
import { Button } from 'nom-ui'
import { useWallet } from '@/core'
import OnboardingLayout from './OnboardingLayout.vue'

const wallet = useWallet()
</script>

<template>
  <OnboardingLayout>
    <div class="flex w-full max-w-[720px] flex-col gap-6 text-center">
      <div v-if="wallet.hasWallets.value" class="text-left">
        <Button as-child variant="ghost" size="sm">
          <RouterLink :to="{ name: 'home' }">Back</RouterLink>
        </Button>
      </div>
      <div class="flex flex-col gap-2">
        <h1 class="text-4xl font-bold tracking-tight">Set up your wallet</h1>
        <p class="text-base text-muted-foreground">
          Hold ZNN, QSR and ZTS tokens and use Zenon dApps. Your keys are encrypted and stay in this
          browser.
        </p>
      </div>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 text-left">
        <RouterLink
          :to="{ name: 'create-password' }"
          class="flex flex-col gap-2 rounded-xl border border-primary bg-card p-6 text-foreground no-underline shadow-md"
        >
          <span class="text-lg font-semibold">Create a new wallet</span>
          <span class="text-sm text-muted-foreground">Get a new 24-word recovery phrase.</span>
          <span class="mt-2 text-sm font-semibold text-primary">Start →</span>
        </RouterLink>
        <RouterLink
          :to="{ name: 'import-phrase' }"
          class="flex flex-col gap-2 rounded-xl border bg-card p-6 text-foreground no-underline"
        >
          <span class="text-lg font-semibold">Import a recovery phrase</span>
          <span class="text-sm text-muted-foreground">
            Restore an existing wallet from 12 or 24 words.
          </span>
          <span class="mt-2 text-sm font-semibold text-info">Import →</span>
        </RouterLink>
      </div>
    </div>
  </OnboardingLayout>
</template>

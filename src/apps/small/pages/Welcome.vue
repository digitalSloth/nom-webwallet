<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Button, ZnnLogo } from 'nom-ui'
import { ChevronLeftIcon } from 'lucide-vue-next'
import { useWallet } from '@/core'

const router = useRouter()
const wallet = useWallet()
</script>

<template>
  <div class="relative flex h-full flex-col">
    <Button
      v-if="wallet.hasWallets.value"
      variant="ghost"
      size="icon-sm"
      class="absolute top-3 left-2"
      aria-label="Back"
      @click="router.push({ name: 'home' })"
    >
      <ChevronLeftIcon />
    </Button>

    <div class="flex flex-col items-center gap-3 px-7 pt-[72px] text-center">
      <ZnnLogo class="h-16 w-auto" />
      <span class="text-ledger">Network of Momentum</span>
      <h1 class="text-2xl font-semibold">NoM Wallet</h1>
      <p class="text-sm text-muted-foreground">
        Hold ZNN, QSR and ZTS tokens and connect to Zenon dApps. Feeless, powered by plasma.
      </p>
    </div>

    <div class="flex-1" />

    <div class="flex flex-col gap-2 px-6">
      <Button size="lg" class="w-full" @click="router.push({ name: 'create-password' })">
        Create a new wallet
      </Button>
      <Button
        variant="outline"
        size="lg"
        class="w-full"
        @click="router.push({ name: 'import-phrase' })"
      >
        Import a recovery phrase
      </Button>
    </div>
    <p class="px-6 py-4 text-center text-xs text-muted-foreground">
      Your keys are encrypted and stored only on this device.
    </p>
  </div>
</template>

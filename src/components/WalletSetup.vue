<script setup lang="ts">
import {Button, Card, CardContent, CardHeader} from 'nom-ui'

const emit = defineEmits<{
  create: []
  import: []
}>()
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <Card class="w-full max-w-md">
      <CardHeader>
        <h1 class="text-2xl font-bold">Welcome to NoM Wallet</h1>
        <p class="text-muted-foreground">Get started by creating or importing a wallet</p>
      </CardHeader>
      <CardContent class="space-y-4">
        <Button class="w-full" size="lg" @click="emit('create')"> Create New Wallet </Button>
        <Button class="w-full" size="lg" variant="outline" @click="emit('import')">
          Import Existing Wallet
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {ref} from 'vue'
import {useRouter} from 'vue-router'
import WalletSetup from '@/components/WalletSetup.vue'
import CreateWalletForm from '@/components/CreateWalletForm.vue'
import ImportWalletForm from '@/components/ImportWalletForm.vue'
import {Card, CardContent} from 'nom-ui'

const router = useRouter()

const mode = ref<'choice' | 'create' | 'import'>('choice')

function handleSuccess() {
  router.push('/')
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <WalletSetup v-if="mode === 'choice'" @create="mode = 'create'" @import="mode = 'import'" />

    <div v-else-if="mode === 'create'" class="flex items-center justify-center min-h-screen p-6">
      <Card class="w-full max-w-md">
        <CardContent class="pt-6">
          <CreateWalletForm
            @success="handleSuccess"
            @cancel="mode = 'choice'"
          />
        </CardContent>
      </Card>
    </div>

    <div v-else-if="mode === 'import'" class="flex items-center justify-center min-h-screen p-6">
      <Card class="w-full max-w-md">
        <CardContent class="pt-6">
          <ImportWalletForm
            @success="handleSuccess"
            @cancel="mode = 'choice'"
          />
        </CardContent>
      </Card>
    </div>
  </div>
</template>

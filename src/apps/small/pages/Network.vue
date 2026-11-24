<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useNetwork, useNodes } from '@/core'
import { Button, Input } from 'nom-ui'
import { PencilIcon, TrashIcon } from 'lucide-vue-next'
import PageHeader from '../components/PageHeader.vue'

const router = useRouter()
const network = useNetwork()
const nodes = useNodes()
const { rows, pending, busy, listError, addUrl, check, edit } = nodes

const reachable = computed(() => (check.value.status === 'reachable' ? check.value : null))
const failed = computed(() => (check.value.status === 'failed' ? check.value : null))

onMounted(() => void nodes.load())
</script>

<template>
  <div class="flex h-full flex-col">
    <PageHeader title="Network" @back="router.push({ name: 'settings' })" />

    <div class="flex-1 space-y-4 overflow-y-auto p-4">
      <section class="space-y-1.5">
        <h2 id="nodes-heading" class="text-ledger text-muted-foreground">Node</h2>
        <div
          role="radiogroup"
          aria-labelledby="nodes-heading"
          class="divide-y overflow-hidden rounded-xl border bg-card"
        >
          <template v-for="row in rows" :key="row.url">
            <div
              class="flex min-h-14 items-center gap-2.5 px-3 py-2"
              :class="{ 'bg-muted': row.url === network.currentNode.value }"
            >
              <button
                type="button"
                role="radio"
                :aria-checked="row.url === network.currentNode.value"
                :aria-label="`Use ${row.url}`"
                class="flex size-5 shrink-0 items-center justify-center rounded-full border bg-card"
                :class="row.url === network.currentNode.value ? 'border-primary' : 'border-border'"
                :disabled="busy"
                @click="nodes.select(row)"
              >
                <span
                  v-if="row.url === network.currentNode.value"
                  class="size-2.5 rounded-full bg-plasma"
                />
              </button>
              <span class="flex min-w-0 grow flex-col gap-0.5">
                <span class="font-mono text-xs break-all">{{ row.url }}</span>
                <span class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span>
                    {{ row.kind }} · <span class="font-mono">{{ row.ids }}</span>
                  </span>
                  <span v-if="pending === row.url">Checking…</span>
                  <template v-else-if="row.url === network.currentNode.value">
                    <span
                      v-if="network.isConnected.value"
                      class="flex items-center gap-1 text-success"
                    >
                      <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
                      Connected
                    </span>
                    <span v-else class="text-destructive">Not connected</span>
                  </template>
                </span>
              </span>
              <template v-if="row.custom">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Edit chain and network ID for ${row.url}`"
                  :disabled="busy"
                  @click="nodes.startEdit(row)"
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="`Remove ${row.url}`"
                  :disabled="busy"
                  @click="nodes.remove(row.url)"
                >
                  <TrashIcon />
                </Button>
              </template>
            </div>
            <div v-if="edit && edit.url === row.url" class="space-y-2.5 bg-muted px-3 py-3">
              <div class="grid grid-cols-2 gap-2">
                <div class="space-y-1">
                  <label for="edit-chain" class="block text-ledger text-muted-foreground">
                    Chain ID
                  </label>
                  <Input id="edit-chain" v-model="edit.chainInput" numeric :disabled="busy" />
                </div>
                <div class="space-y-1">
                  <label for="edit-net" class="block text-ledger text-muted-foreground">
                    Network ID
                  </label>
                  <Input id="edit-net" v-model="edit.networkInput" numeric :disabled="busy" />
                </div>
              </div>
              <p v-if="edit.error" role="alert" class="text-xs text-destructive">
                {{ edit.error }}
              </p>
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" :disabled="busy" @click="nodes.cancelEdit()">
                  Cancel
                </Button>
                <Button type="button" :disabled="busy" @click="nodes.saveEdit()">
                  Save and connect
                </Button>
              </div>
            </div>
          </template>
        </div>
        <p v-if="listError" role="alert" class="text-xs text-destructive">{{ listError }}</p>
        <p class="text-xs text-muted-foreground">
          Each node keeps its own chain and network ID, so switching node switches both.
        </p>
      </section>

      <form class="space-y-2" @submit.prevent="nodes.checkNode()">
        <label for="new-node" class="block text-ledger text-muted-foreground">Add a node</label>
        <div class="flex gap-2">
          <Input
            id="new-node"
            v-model="addUrl"
            class="flex-1 font-mono text-xs"
            placeholder="wss://…"
            autocomplete="off"
            spellcheck="false"
            :disabled="busy"
          />
          <Button type="submit" variant="outline" :disabled="busy || !addUrl.trim()">
            {{ check.status === 'checking' ? 'Checking…' : 'Check' }}
          </Button>
        </div>
        <p v-if="failed" role="alert" class="text-xs leading-snug text-destructive">
          {{ failed.message }}
        </p>
        <div v-if="reachable" class="space-y-2.5 rounded-lg border bg-muted p-3">
          <span class="flex items-center gap-1.5 text-xs text-success">
            <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
            Reachable · IDs read from the node
          </span>
          <div class="grid grid-cols-2 gap-2">
            <div class="space-y-1">
              <label for="add-chain" class="block text-ledger text-muted-foreground">
                Chain ID
              </label>
              <Input
                id="add-chain"
                @keydown.enter.prevent="nodes.addAndConnect()"
                v-model="reachable.chainInput"
                numeric
                :disabled="busy"
              />
            </div>
            <div class="space-y-1">
              <label for="add-net" class="block text-ledger text-muted-foreground">
                Network ID
              </label>
              <Input
                id="add-net"
                @keydown.enter.prevent="nodes.addAndConnect()"
                v-model="reachable.networkInput"
                numeric
                :disabled="busy"
              />
            </div>
          </div>
          <p v-if="reachable.error" role="alert" class="text-xs text-destructive">
            {{ reachable.error }}
          </p>
          <Button type="button" class="w-full" :disabled="busy" @click="nodes.addAndConnect()">
            Add and connect
          </Button>
        </div>
        <p v-if="check.status === 'idle'" class="text-xs text-muted-foreground">
          The wallet checks the node and reads its chain and network ID before adding it.
        </p>
      </form>
    </div>
  </div>
</template>

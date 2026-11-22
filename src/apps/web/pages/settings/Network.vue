<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useNetwork, useNodes } from '@/core'
import { CONNECT_TIMEOUT_MS } from '@/config'
import { Button, Input } from 'nom-ui'

const network = useNetwork()
const nodes = useNodes()
const { rows, pending, busy, listError, addUrl, check, edit } = nodes

const reachable = computed(() => (check.value.status === 'reachable' ? check.value : null))
const failed = computed(() => (check.value.status === 'failed' ? check.value : null))

onMounted(() => void nodes.load())
</script>

<template>
  <section aria-labelledby="node-h" class="rounded-xl border bg-card shadow-md">
    <div class="flex flex-col gap-1 border-b px-5 py-4">
      <h2 id="node-h" class="text-base font-semibold">Node</h2>
      <p class="text-[13px] text-muted-foreground">
        The wallet reads balances and publishes transactions through this node. Each node keeps its
        own chain and network ID, so switching node switches both.
      </p>
    </div>
    <div role="radiogroup" aria-labelledby="node-h" class="flex flex-col">
      <template v-for="(row, i) in rows" :key="row.url">
        <div
          class="flex flex-wrap items-center gap-3 px-5 py-3"
          :class="[
            i > 0 ? 'border-t' : '',
            row.url === network.currentNode.value ? 'bg-muted' : '',
          ]"
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
            <span class="font-mono text-sm break-all">{{ row.url }}</span>
            <span class="text-xs text-muted-foreground">
              {{ row.kind }} · <span class="font-mono">{{ row.ids }}</span>
            </span>
          </span>
          <span v-if="pending === row.url" class="text-xs text-muted-foreground">Checking…</span>
          <template v-else-if="row.url === network.currentNode.value">
            <span
              v-if="network.isConnected.value"
              class="flex items-center gap-1.5 text-xs text-success"
            >
              <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
              Connected
            </span>
            <span v-else class="text-xs text-destructive">Not connected</span>
          </template>
          <template v-if="row.custom">
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Edit chain and network ID for ${row.url}`"
              :disabled="busy"
              @click="nodes.startEdit(row)"
            >
              Edit IDs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              :aria-label="`Remove ${row.url}`"
              :disabled="busy"
              @click="nodes.remove(row.url)"
            >
              Remove
            </Button>
          </template>
        </div>
        <div
          v-if="edit && edit.url === row.url"
          class="flex flex-col gap-3 border-t bg-muted px-5 py-4"
        >
          <div class="grid max-w-[520px] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            <div class="flex flex-col gap-1.5">
              <label for="edit-chain" class="text-ledger text-muted-foreground">Chain ID</label>
              <Input id="edit-chain" v-model="edit.chainInput" numeric :disabled="busy" />
            </div>
            <div class="flex flex-col gap-1.5">
              <label for="edit-net" class="text-ledger text-muted-foreground">Network ID</label>
              <Input id="edit-net" v-model="edit.networkInput" numeric :disabled="busy" />
            </div>
          </div>
          <p v-if="edit.error" role="alert" class="text-[13px] text-destructive">
            {{ edit.error }}
          </p>
          <div class="flex gap-2">
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
    <p v-if="listError" role="alert" class="border-t px-5 py-3 text-[13px] text-destructive">
      {{ listError }}
    </p>
    <form
      class="flex flex-col gap-3 rounded-b-xl border-t bg-muted px-5 py-4"
      @submit.prevent="nodes.checkNode()"
    >
      <div class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
          <label for="custom-node" class="text-ledger text-muted-foreground">Add a node</label>
          <Input
            id="custom-node"
            v-model="addUrl"
            class="font-mono"
            placeholder="wss://…"
            autocomplete="off"
            spellcheck="false"
            :disabled="busy"
          />
        </div>
        <Button type="submit" variant="outline" :disabled="busy || !addUrl.trim()">
          {{ check.status === 'checking' ? 'Checking…' : 'Check node' }}
        </Button>
      </div>
      <p v-if="failed" role="alert" class="text-[13px] text-destructive">{{ failed.message }}</p>
      <div v-if="reachable" class="flex flex-wrap items-end gap-3">
        <span class="flex basis-full items-center gap-1.5 text-[13px] text-success">
          <span class="size-1.5 rounded-full bg-success" aria-hidden="true" />
          Reachable · chain and network ID read from the node
        </span>
        <div class="flex flex-[0_1_160px] flex-col gap-1.5">
          <label for="add-chain" class="text-ledger text-muted-foreground">Chain ID</label>
          <Input
            id="add-chain"
            @keydown.enter.prevent="nodes.addAndConnect()"
            v-model="reachable.chainInput"
            numeric
            :disabled="busy"
          />
        </div>
        <div class="flex flex-[0_1_160px] flex-col gap-1.5">
          <label for="add-net" class="text-ledger text-muted-foreground">Network ID</label>
          <Input
            id="add-net"
            @keydown.enter.prevent="nodes.addAndConnect()"
            v-model="reachable.networkInput"
            numeric
            :disabled="busy"
          />
        </div>
        <Button type="button" :disabled="busy" @click="nodes.addAndConnect()">
          Add and connect
        </Button>
        <p v-if="reachable.error" role="alert" class="basis-full text-[13px] text-destructive">
          {{ reachable.error }}
        </p>
      </div>
      <p v-if="check.status === 'idle'" class="text-xs text-muted-foreground">
        The wallet checks the node responds and reads its chain and network ID before adding it.
        Unreachable nodes fail after {{ CONNECT_TIMEOUT_MS / 1000 }} seconds and keep your current
        node.
      </p>
    </form>
  </section>
</template>

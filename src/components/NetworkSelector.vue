<script setup lang="ts">
import {computed, onMounted, ref, watch} from 'vue'
import {
  Button,
  Field,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  useToast
} from '@nom/ui'
import {CheckIcon, TrashIcon} from 'lucide-vue-next'
import {useStorage} from '@/core'
import {DEFAULT_NODES} from '@/config'

export interface NetworkSelectorProps {
  currentNode: string
}

const props = defineProps<NetworkSelectorProps>()

const emit = defineEmits<{
  select: [nodeUrl: string]
  'update-network-config': [chainId: number, networkId: number]
}>()

const CUSTOM_NODES_STORAGE_KEY = 'nom-wallet-custom-nodes'
const SELECTED_NODE_STORAGE_KEY = 'nom-wallet-selected-node'
const CHAIN_ID_STORAGE_KEY = 'nom-wallet-chain-id'
const NETWORK_ID_STORAGE_KEY = 'nom-wallet-network-id'
const storage = useStorage()
const toast = useToast()

const defaultNodes = DEFAULT_NODES

const customNode = ref('')
const selectedNode = ref(props.currentNode)
const customNodes = ref<string[]>([])
const chainId = ref<number>(1)
const networkId = ref<number>(1)

interface NodeItem {
  url: string
  isCustom: boolean
}

const allNodes = computed<NodeItem[]>(() => {
  const defaults = defaultNodes.map(url => ({ url, isCustom: false }))
  const customs = customNodes.value.map(url => ({ url, isCustom: true }))
  return [...defaults, ...customs]
})

watch(() => props.currentNode, (newVal) => {
  selectedNode.value = newVal
})

async function loadCustomNodes() {
  try {
    const stored = await storage.get<string[]>(CUSTOM_NODES_STORAGE_KEY)
    if (stored) {
      customNodes.value = stored
    }
  } catch (e) {
    console.error('Failed to load custom nodes:', e)
    customNodes.value = []
  }
}

async function loadSelectedNode() {
  try {
    const stored = await storage.get<string>(SELECTED_NODE_STORAGE_KEY)
    if (stored) {
      // Emit the stored node to parent component
      emit('select', stored)
    }
  } catch (e) {
    console.error('Failed to load selected node:', e)
  }
}

async function loadNetworkConfig() {
  try {
    const storedChainId = await storage.get<number>(CHAIN_ID_STORAGE_KEY)
    const storedNetworkId = await storage.get<number>(NETWORK_ID_STORAGE_KEY)

    if (storedChainId !== null) {
      chainId.value = storedChainId
    }
    if (storedNetworkId !== null) {
      networkId.value = storedNetworkId
    }

    // Emit the loaded config to parent
    emit('update-network-config', chainId.value, networkId.value)
  } catch (e) {
    console.error('Failed to load network config:', e)
  }
}

async function saveCustomNodes() {
  try {
    await storage.set(CUSTOM_NODES_STORAGE_KEY, customNodes.value)
  } catch (e) {
    console.error('Failed to save custom nodes:', e)
    toast.show('Failed to save custom node', 'error')
  }
}

async function saveSelectedNode(nodeUrl: string) {
  try {
    await storage.set(SELECTED_NODE_STORAGE_KEY, nodeUrl)
  } catch (e) {
    console.error('Failed to save selected node:', e)
    toast.show('Failed to save node selection', 'error')
  }
}

async function saveNetworkConfig() {
  try {
    await storage.set(CHAIN_ID_STORAGE_KEY, chainId.value)
    await storage.set(NETWORK_ID_STORAGE_KEY, networkId.value)
  } catch (e) {
    console.error('Failed to save network config:', e)
    toast.show('Failed to save network configuration', 'error')
  }
}

async function handleNetworkConfigChange() {
  await saveNetworkConfig()
  emit('update-network-config', chainId.value, networkId.value)
}

async function handleSelect(nodeUrl: string) {
  selectedNode.value = nodeUrl
  await saveSelectedNode(nodeUrl)
  emit('select', nodeUrl)
}

async function handleCustomNodeSubmit() {
  if (customNode.value && (customNode.value.startsWith('wss://') || customNode.value.startsWith('ws://'))) {
    // Add to custom nodes if not already present
    if (!customNodes.value.includes(customNode.value) && !defaultNodes.includes(customNode.value)) {
      customNodes.value.push(customNode.value)
      await saveCustomNodes()
    }
    await handleSelect(customNode.value)
    customNode.value = ''
  }
}

async function handleDeleteCustomNode(nodeUrl: string) {
  customNodes.value = customNodes.value.filter(url => url !== nodeUrl)
  await saveCustomNodes()

  // If the deleted node was selected, switch to first default node
  if (selectedNode.value === nodeUrl) {
    await handleSelect(defaultNodes[0])
  }
}

onMounted(async () => {
  await loadCustomNodes()
  await loadNetworkConfig()
  await loadSelectedNode()
})
</script>

<template>
  <div class="space-y-3 min-w-[320px]">

    <div class="font-semibold text-lg">Node Management</div>

    <div class="space-y-2">
      <Item
          v-for="node in allNodes"
          :key="node.url"
          :class="[
                'transition-colors',
                selectedNode === node.url ? 'bg-primary/10 border-primary/50' : '',
              ]"
          variant="hover"
          size="sm"
          @click="handleSelect(node.url)"
      >
        <ItemContent class="flex-1">
          <ItemTitle>{{ node.isCustom ? 'Custom Node' : `Default Node` }}</ItemTitle>
          <ItemDescription class="font-mono">
            {{ node.url }}
          </ItemDescription>
        </ItemContent>
        <Button
            v-if="node.isCustom"
            type="button"
            variant="ghost"
            @click.stop="handleDeleteCustomNode(node.url)"
            class="text-muted-foreground hover:text-destructive"
        >
          <TrashIcon class="h-3.5 w-3.5" />
        </Button>
      </Item>
    </div>

    <Field class="mt-4">
      <FieldLabel for="custom-node">
        Custom Node URL
      </FieldLabel>
      <InputGroup>
        <InputGroupInput
            v-model="customNode"
            placeholder="wss://..."
            @keyup.enter="handleCustomNodeSubmit"
            id="custom-node"
            class="bg-background"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
              type="button"
              size="icon-xs"
              @click="handleCustomNodeSubmit"
              :disabled="!customNode || !customNode.startsWith('wss://')"
          >
            <CheckIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>

    <div class="font-semibold text-lg mt-4">Network Configuration</div>

    <div class="grid grid-cols-2 gap-4">
      <Field>
        <FieldLabel for="chain-id">
          Chain ID
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
              v-model.number="chainId"
              type="text"
              id="chain-id"
              placeholder="1"
              @change="handleNetworkConfigChange"
          />
        </InputGroup>
      </Field>

      <Field>
        <FieldLabel for="network-id">
          Network ID
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
              v-model.number="networkId"
              type="text"
              id="network-id"
              placeholder="1"
              @change="handleNetworkConfigChange"
          />
        </InputGroup>
      </Field>
    </div>
  </div>
</template>

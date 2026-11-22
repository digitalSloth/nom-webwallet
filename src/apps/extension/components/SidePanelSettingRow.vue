<script setup lang="ts">
import { ref } from 'vue'
import { Switch, useToast } from 'nom-ui'
import { useSidePanelSetting } from '../useSidePanelSetting'

const toast = useToast()
const sidePanel = useSidePanelSetting()
const savingSidePanel = ref(false)

async function onSidePanelChange(on: boolean): Promise<void> {
  if (savingSidePanel.value) return
  savingSidePanel.value = true
  try {
    await sidePanel.setEnabled(on)
  } catch {
    toast.show('Could not save the side panel setting.', 'error')
  } finally {
    savingSidePanel.value = false
  }
}
</script>

<template>
  <div class="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
    <label for="side-panel">
      <span class="block text-sm font-medium">Open in side panel</span>
      <span class="block text-xs text-muted-foreground">
        The toolbar icon opens the wallet beside the page
      </span>
    </label>
    <Switch
      id="side-panel"
      :model-value="sidePanel.enabled.value"
      :disabled="savingSidePanel"
      @update:model-value="onSidePanelChange($event === true)"
    />
  </div>
</template>

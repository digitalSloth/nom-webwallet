import { nextTick } from 'vue'

// Most layers stacked at once: a popover and a select can both be open.
const MAX_OPEN_LAYERS = 4

type LayerDocument = Pick<Document, 'dispatchEvent' | 'querySelector'>

/**
 * Closes the open popovers and selects of the page underneath. They render
 * in portals outside the inert wrapper, so they would otherwise stay above
 * and take clicks from an approval screen. Each Escape closes the topmost
 * layer, which leaves the DOM on the next render, so the loop waits a tick
 * and repeats while a layer remains.
 */
export async function dismissOpenLayers(doc: LayerDocument = document): Promise<void> {
  for (let i = 0; i < MAX_OPEN_LAYERS; i++) {
    if (!doc.querySelector('[data-dismissable-layer]')) return
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
  }
}

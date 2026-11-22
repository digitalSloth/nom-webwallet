import { afterEach, describe, expect, it, vi } from 'vitest'

import { dismissOpenLayers } from './dismiss-layers'

class FakeKeyboardEvent extends Event {
  key: string
  constructor(type: string, init: { key?: string; bubbles?: boolean } = {}) {
    super(type, { bubbles: init.bubbles })
    this.key = init.key ?? ''
  }
}

// A document with `layers` open layers. Each Escape removes one layer.
function fakeDoc(layers: number, closes = true) {
  const events: FakeKeyboardEvent[] = []
  const doc = {
    layers,
    events,
    querySelector: () => (doc.layers > 0 ? {} : null),
    dispatchEvent(e: Event) {
      events.push(e as FakeKeyboardEvent)
      if (closes) doc.layers--
      return true
    },
  }
  return doc
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dismissOpenLayers', () => {
  it('dispatches nothing when no layer is open', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(0)

    await dismissOpenLayers(doc as unknown as Document)

    expect(doc.events).toHaveLength(0)
  })

  it('dispatches a bubbling Escape keydown for one open layer', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(1)

    await dismissOpenLayers(doc as unknown as Document)

    expect(doc.events).toHaveLength(1)
    expect(doc.events[0].type).toBe('keydown')
    expect(doc.events[0].key).toBe('Escape')
    expect(doc.events[0].bubbles).toBe(true)
  })

  it('closes stacked layers one Escape at a time', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(3)

    await dismissOpenLayers(doc as unknown as Document)

    expect(doc.events).toHaveLength(3)
    expect(doc.layers).toBe(0)
  })

  it('waits a tick for each layer to leave the document before checking again', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(3, false)
    doc.dispatchEvent = (e: Event) => {
      doc.events.push(e as FakeKeyboardEvent)
      void Promise.resolve().then(() => {
        doc.layers--
      })
      return true
    }

    await dismissOpenLayers(doc as unknown as Document)

    expect(doc.events).toHaveLength(3)
    expect(doc.layers).toBe(0)
  })

  it('stops after four Escapes when a layer will not close', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(1, false)

    await dismissOpenLayers(doc as unknown as Document)

    expect(doc.events).toHaveLength(4)
  })

  it('defaults to document', async () => {
    vi.stubGlobal('KeyboardEvent', FakeKeyboardEvent)
    const doc = fakeDoc(1)
    vi.stubGlobal('document', doc)

    await dismissOpenLayers()

    expect(doc.events).toHaveLength(1)
  })
})

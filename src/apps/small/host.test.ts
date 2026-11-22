import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { SMALL_HOST_KEY, injectSmallHost, type SmallHost } from './host'

async function renderWith<T>(
  rootSetup: () => void,
  childSetup: () => T,
): Promise<T> {
  let result!: T
  const child = defineComponent({
    setup() {
      result = childSetup()
      return () => h('div')
    },
  })
  const root = defineComponent({
    setup() {
      rootSetup()
      return () => h(child)
    },
  })
  await renderToString(createSSRApp(root))
  return result
}

describe('injectSmallHost', () => {
  it('returns the host a root provided', async () => {
    const host: SmallHost = {
      kind: 'web',
      placeLabel: 'page',
      appVersion: '1.2.3',
      useConnections: () => ({ label: 'Connected apps', detail: ref('') }),
      requestUnlock: vi.fn(),
    }
    const got = await renderWith(() => provide(SMALL_HOST_KEY, host), injectSmallHost)
    expect(got).toBe(host)
  })

  it('throws when no root provided a host', async () => {
    await expect(renderWith(() => {}, injectSmallHost)).rejects.toThrow(
      'The small app host was not provided by a root component.',
    )
  })
})

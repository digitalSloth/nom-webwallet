import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const rowModule = { default: { name: 'SidePanelSettingRow' } }

async function load(search = '') {
  vi.resetModules()
  vi.doMock('@/apps/extension/components/SidePanelSettingRow.vue', () => rowModule)
  vi.stubGlobal('location', { pathname: '/popup.html', search })
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version: '9.8.7' }) },
    storage: { onChanged: { addListener: vi.fn() } },
  })
  const { provideExtensionHost } = await import('@/apps/extension/small-host')
  const { injectSmallHost } = await import('@/apps/small/host')
  return { provideExtensionHost, injectSmallHost }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provideExtensionHost', () => {
  it('supplies the extension host with the surface label, version and side panel row', async () => {
    const { provideExtensionHost, injectSmallHost } = await load('?surface=tab')
    const unlock = vi.fn()
    let result!: ReturnType<typeof injectSmallHost>
    let connections!: ReturnType<ReturnType<typeof injectSmallHost>['useConnections']>
    const child = defineComponent({
      setup() {
        result = injectSmallHost()
        connections = result.useConnections()
        return () => h('div')
      },
    })
    const root = defineComponent({
      setup() {
        provideExtensionHost(unlock)
        return () => h(child)
      },
    })
    await renderToString(createSSRApp(root))
    expect(result.kind).toBe('extension')
    expect(result.placeLabel).toBe('tab')
    expect(result.appVersion).toBe('9.8.7')
    expect(result.settingsExtras).toBe(rowModule.default)
    expect(connections.label).toBe('Connected sites')
    expect(connections.detail.value).toMatch(/^0 sites/)
    result.requestUnlock('/send')
    expect(unlock).toHaveBeenCalledWith('/send')
  })
})

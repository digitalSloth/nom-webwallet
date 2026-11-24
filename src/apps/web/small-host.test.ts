import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

const walletConnect = { isEnabled: true, sessions: computed(() => [] as unknown[]) }

async function load(sessions: number, isEnabled = true) {
  vi.resetModules()
  walletConnect.isEnabled = isEnabled
  walletConnect.sessions = computed(() => Array.from({ length: sessions }))
  vi.doMock('@/core', () => ({ useWalletConnect: () => walletConnect }))
  vi.stubGlobal('__APP_VERSION__', '9.9.9')
  const { provideWebHost } = await import('@/apps/web/small-host')
  const { injectSmallHost } = await import('@/apps/small/host')
  return { provideWebHost, injectSmallHost }
}

async function render(sessions: number, isEnabled = true) {
  const { provideWebHost, injectSmallHost } = await load(sessions, isEnabled)
  const push = vi.fn()
  let host!: ReturnType<typeof injectSmallHost>
  let connections!: ReturnType<ReturnType<typeof injectSmallHost>['useConnections']>
  const child = defineComponent({
    setup() {
      host = injectSmallHost()
      connections = host.useConnections()
      return () => h('div')
    },
  })
  const root = defineComponent({
    setup() {
      provideWebHost({ push } as never)
      return () => h(child)
    },
  })
  await renderToString(createSSRApp(root))
  return { host, connections, push }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provideWebHost', () => {
  it('supplies the web host with the page label, the build version and no Settings extras', async () => {
    const { host } = await render(0)
    expect(host.kind).toBe('web')
    expect(host.placeLabel).toBe('page')
    expect(host.appVersion).toBe('9.9.9')
    expect(host.settingsExtras).toBeUndefined()
  })

  it('moves to the given page on an unlock request', async () => {
    const { host, push } = await render(0)
    host.requestUnlock('/send')
    expect(push).toHaveBeenCalledWith('/send')
  })

  it('does nothing for an unlock request with no page', async () => {
    const { host, push } = await render(0)
    host.requestUnlock()
    expect(push).not.toHaveBeenCalled()
  })

  it.each([
    [1, '1 WalletConnect session'],
    [2, '2 WalletConnect sessions'],
  ])(
    'labels the connections row Connected apps and counts the WalletConnect sessions (%s)',
    async (count, detail) => {
      const { connections } = await render(count)
      expect(connections.label).toBe('Connected apps')
      expect(connections.detail.value).toBe(detail)
    }
  )

  it('says WalletConnect is not configured when it is off', async () => {
    const { connections } = await render(0, false)
    expect(connections.detail.value).toBe('WalletConnect is not configured')
  })
})

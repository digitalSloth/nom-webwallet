import { beforeEach, describe, expect, it, vi } from 'vitest'

const getBasicSendQuote = vi.fn()
const service = {
  getBasicSendQuote,
  getPlasmaLevel: (available: number, perSend: number) =>
    available >= 10 * perSend ? 'high' : available >= perSend ? 'medium' : 'low',
}

vi.mock('@/core/account-service', () => ({
  AccountService: { getInstance: () => service },
}))

const { usePlasmaLevel } = await import('@/core/composables/usePlasmaLevel')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('usePlasmaLevel', () => {
  it('starts loading with no level, then becomes ready', async () => {
    getBasicSendQuote.mockResolvedValue({ available: 231000, perSend: 23100 })

    const { level, status } = usePlasmaLevel('z1account')
    expect(status.value).toBe('loading')
    expect(level.value).toBeNull()

    await flush()
    expect(getBasicSendQuote).toHaveBeenCalledWith('z1account')
    expect(status.value).toBe('ready')
    expect(level.value).toBe('high')
  })

  it('becomes unavailable on a failed lookup without throwing', async () => {
    getBasicSendQuote.mockRejectedValue(new Error('offline'))

    const { level, status } = usePlasmaLevel('z1account')
    await flush()

    expect(status.value).toBe('unavailable')
    expect(level.value).toBeNull()
  })

  it('stays loading while the lookup never settles', async () => {
    getBasicSendQuote.mockReturnValue(new Promise(() => {}))

    const { level, status } = usePlasmaLevel('z1account')
    await flush()

    expect(status.value).toBe('loading')
    expect(level.value).toBeNull()
  })
})

import { onScopeDispose, readonly, shallowRef, type Ref } from 'vue'

/**
 * Holds one secret for at most `ms`. It clears on hide(), after `ms`, when the
 * document turns hidden, and when the calling scope is disposed. A load still
 * running when any of these happens is discarded.
 */
export function useTimedReveal(ms: number): {
  value: Readonly<Ref<string | null>>
  reveal(load: () => Promise<string>): Promise<void>
  hide(): void
} {
  const value = shallowRef<string | null>(null)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function hide(): void {
    generation++
    value.value = null
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  async function reveal(load: () => Promise<string>): Promise<void> {
    const started = generation
    const secret = await load()
    if (started !== generation || document.visibilityState === 'hidden') return
    value.value = secret
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(hide, ms)
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') hide()
  }

  document.addEventListener('visibilitychange', onVisibility)
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisibility)
    hide()
  })

  return { value: readonly(value), reveal, hide }
}

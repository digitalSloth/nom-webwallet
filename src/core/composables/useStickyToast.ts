export interface StickyToastHost {
  error(message: string, options: { duration: number; closeButton: boolean }): string | number
  dismiss(id?: string | number): unknown
}

/**
 * Shows a toast that stays until the user closes it, and removes it when
 * the host calls `dismiss`, so it never lingers over a later request. A
 * new toast replaces the previous one.
 */
export function useStickyToast(host: StickyToastHost) {
  let currentId: string | number | undefined

  function dismiss(): void {
    if (currentId === undefined) return
    host.dismiss(currentId)
    currentId = undefined
  }

  function showError(message: string): void {
    dismiss()
    currentId = host.error(message, { duration: Infinity, closeButton: true })
  }

  return { showError, dismiss }
}
